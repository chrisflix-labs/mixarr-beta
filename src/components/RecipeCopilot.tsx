"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Clock3, History, Loader2, RotateCcw, ShieldAlert, Sparkles, X } from "lucide-react";
import styles from "./RecipeCopilot.module.css";
import RecommendationExplanationPanel from "./RecommendationExplanationPanel";
import { isRecipeCopilotCostLimitError, isRecipeCopilotRequestLimitError, isRecipeCopilotSetupError, recipeCopilotCanRequest, recipeCopilotDailyRequestSummary, recipeCopilotErrorMessage, type RecipeCopilotReadiness } from "@/lib/recipeCopilot/readiness";
import { readRecipeCopilotResponse, RecipeCopilotHttpError } from "@/lib/recipeCopilot/http";
import {
  getRecipeProposalPath, stableRecipeProposalChangeId, type ApplyRecipeProposalRequest,
  type ApplyRecipeProposalResult, type RecipeProposalChange, type RecipeProposalConflict,
  type RecipeProposalConflictResolution,
} from "@/lib/recipeCopilot/proposalApply";
import { SCORING_MODELS } from "@/lib/scoringModelCatalog";

type Action = "create" | "refine" | "explain" | "diagnose" | "optimize" | "compare_intent" | "from_playlist" | "suggest_names" | "generate_description" | "onboarding";
type Props = {
  open: boolean;
  recipeId?: string;
  draft: Record<string, any>;
  dirty: boolean;
  formReady: boolean;
  getDraftSnapshot: () => Record<string, any>;
  onClose: () => void;
  onDraft: (draft: Record<string, any>, persisted?: boolean) => void;
  onApplyChanges?: (request: ApplyRecipeProposalRequest) => Promise<ApplyRecipeProposalResult>;
  onNotice: (message: string) => void;
};
const actions: Array<{ id: Action; label: string; hint: string }> = [
  { id: "create", label: "Create", hint: "Build a structured draft from a description" },
  { id: "refine", label: "Refine", hint: "Propose reviewable changes" },
  { id: "explain", label: "Explain", hint: "Translate current rules into plain language" },
  { id: "diagnose", label: "Diagnose", hint: "Analyze poor or unexpected results" },
  { id: "optimize", label: "Optimize", hint: "Improve while preserving purpose" },
  { id: "compare_intent", label: "Compare intent", hint: "Compare desired and configured behavior" },
  { id: "from_playlist", label: "From playlist", hint: "Derive a reusable concept from an example" },
  { id: "suggest_names", label: "Suggest names", hint: "Generate several safe names" },
  { id: "generate_description", label: "Description", hint: "Generate an accurate description" },
  { id: "onboarding", label: "Onboarding", hint: "Generate review and first-run guidance" },
];
const readOnly = new Set<Action>(["explain", "diagnose", "compare_intent", "suggest_names", "onboarding"]);
const approvalConfirmation = "I reviewed this AI-generated recipe and understand that its behavior may differ from the original request.";

function display(value: unknown) { if (value === undefined) return "Not set"; if (typeof value === "string") return value; return JSON.stringify(value); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function setPath(value: any, path: string, next: unknown) { const parts = path.split("."); let current = value; parts.slice(0, -1).forEach((part) => { if (!current[part] || typeof current[part] !== "object") current[part] = {}; current = current[part]; }); current[parts.at(-1)!] = next; }
function inferredPurpose(recipe: Record<string, any>) { const balance = Number(recipe.discovery?.familiarityBalance ?? 50); return `Create a ${balance >= 65 ? "mostly familiar" : balance <= 35 ? "discovery-forward" : "balanced"} ${String(recipe.category || "custom").toLowerCase()} playlist with controlled artist repetition and ${recipe.targets?.energyProgression || "mixed"} energy.`; }

export default function RecipeCopilot({ open, recipeId, draft, dirty, formReady, getDraftSnapshot, onClose, onDraft, onApplyChanges, onNotice }: Props) {
  const [action, setAction] = useState<Action>(recipeId ? "refine" : "create");
  const [instruction, setInstruction] = useState("");
  const [purpose, setPurpose] = useState(() => inferredPurpose(draft));
  const [availability, setAvailability] = useState<RecipeCopilotReadiness | null>(null);
  const [preflightState, setPreflightState] = useState<"loading" | "ready" | "error">("loading");
  const [preflightVersion, setPreflightVersion] = useState(0);
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorRequestId, setErrorRequestId] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<Record<string, any> | null>(null);
  const [proposal, setProposal] = useState<any>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [invalidEditPaths, setInvalidEditPaths] = useState<Set<string>>(new Set());
  const [applyConflicts, setApplyConflicts] = useState<RecipeProposalConflict[]>([]);
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, RecipeProposalConflictResolution>>({});
  const [editedRecipe, setEditedRecipe] = useState<Record<string, any> | null>(null);
  const [history, setHistory] = useState<any[] | null>(null);
  const [approvedConfirm, setApprovedConfirm] = useState(false);
  const [playlists, setPlaylists] = useState<Array<{ id: string; name: string; tracks: number }>>([]);
  const [playlistId, setPlaylistId] = useState("");
  const abort = useRef<AbortController | null>(null);
  const applyingRef = useRef(false);
  const closeButton = useRef<HTMLButtonElement | null>(null);
  const dialog = useRef<HTMLElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => { if (!open) return; opener.current = document.activeElement as HTMLElement; closeButton.current?.focus(); setPurpose(inferredPurpose(draft)); setError(""); setErrorCode(null); setErrorRequestId(null); setErrorDetails(null); setPreflightVersion((value) => value + 1); return () => opener.current?.focus(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open) return; const refresh = () => setPreflightVersion((value) => value + 1); window.addEventListener("focus", refresh); return () => window.removeEventListener("focus", refresh); }, [open]);
  useEffect(() => { if (!open) return; const keyboard = (event: KeyboardEvent) => { if (event.key === "Escape" && !running && !applying) { onClose(); return; } if (event.key !== "Tab") return; const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]),select:not([disabled]),textarea:not([disabled]),input:not([disabled]),a[href],summary') || []); if (!focusable.length) return; const first = focusable[0], last = focusable.at(-1)!; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }; window.addEventListener("keydown", keyboard); return () => window.removeEventListener("keydown", keyboard); }, [open, running, applying, onClose]);
  useEffect(() => { if (!open) return; fetch("/api/generated-playlists").then((response) => response.ok ? response.json() : { playlists: [] }).then((body) => setPlaylists((body.playlists || []).map((item: any) => ({ id: item.id, name: item.plexPlaylistTitle, tracks: item.trackCount || item._count?.tracks || 0 })))).catch(() => setPlaylists([])); }, [open]);
  useEffect(() => {
    if (!open) return; let cancelled = false; setPreflightState("loading");
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/recipes/ai/preflight", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, instruction, purpose, recipe: draft }) });
        const body = await readRecipeCopilotResponse(response, "Copilot preflight failed.");
        if (!cancelled) { setAvailability(body); setPreflightState("ready"); if (body.available) { setError(""); setErrorCode(null); } }
      } catch (caught) { if (!cancelled) { const code = String((caught as any)?.code || "PREFLIGHT_FAILED"); const message = caught instanceof Error ? caught.message : "Copilot preflight failed."; setAvailability({ available: false, blockedReasonCode: code, blockedReasonMessage: message, code, reason: message }); setPreflightState("error"); } }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, action, instruction, purpose, draft, preflightVersion]);

  const sourceLabel = recipeId ? dirty ? "Current unsaved recipe" : "Last saved recipe" : "New unsaved recipe";
  const changes = useMemo(() => proposal?.changes || [], [proposal?.changes]);
  const reviewChanges: RecipeProposalChange[] = useMemo(() => changes.map((change: any) => {
    const id = stableRecipeProposalChangeId(String(proposal?.id || ""), String(change.path || ""));
    return {
      id,
      path: String(change.path || ""),
      currentValue: proposal?.baseDraft ? getRecipeProposalPath(proposal.baseDraft, String(change.path || "")) : change.before,
      proposedValue: editedRecipe ? getRecipeProposalPath(editedRecipe, String(change.path || "")) : change.after,
      selected: selected.has(id),
      confidence: typeof change.confidence === "number" ? change.confidence : undefined,
      explanation: typeof change.reason === "string" ? change.reason : undefined,
    };
  }), [changes, editedRecipe, proposal?.baseDraft, proposal?.id, selected]);
  const selectedChanges = reviewChanges.filter((change) => change.selected);
  const allSelected = reviewChanges.length > 0 && selectedChanges.length === reviewChanges.length;
  const proposalUnavailable = !proposal?.id || ["REJECTED", "SUPERSEDED", "QUARANTINED"].includes(String(proposal?.status || ""));
  const proposalTypeStale = Boolean(proposal?.baseDraft?.category && draft.category !== proposal.baseDraft.category);
  const canRequest = formReady && recipeCopilotCanRequest({ readiness: availability, running, action, instruction, playlistId });
  const resultSections = useMemo(() => proposal?.analysis || {}, [proposal]);

  async function generate() {
    const externalConfirmation = availability?.previewRequired
      ? window.confirm(`This request will send the privacy-filtered fields shown in the preview to ${availability?.provider || "an external AI provider"}. Continue?`)
      : false;
    if (availability?.previewRequired && !externalConfirmation) return;
    if (!formReady) {
      setErrorCode("AI_RECIPE_PROPOSAL_FORM_UNAVAILABLE");
      setError("Recipe Studio is still initializing. Wait for the active draft to finish loading.");
      return;
    }
    const baseDraft = getDraftSnapshot();
    setRunning(true); setError(""); setErrorRequestId(null); setErrorDetails(null); setProposal(null); setApplyConflicts([]); setConflictResolutions({}); setStage("Preparing privacy-aware context");
    const controller = new AbortController(); abort.current = controller;
    try {
      setStage("Waiting for provider");
      const endpoint = action === "from_playlist" ? "/api/recipes/ai/from-playlist" : recipeId && action !== "create" ? `/api/recipes/${encodeURIComponent(recipeId)}/ai/${action}` : action === "create" ? "/api/recipes/ai/create" : "/api/recipes/ai";
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ action, instruction, purpose: action === "optimize" ? purpose : undefined, recipe: baseDraft, baseDraft, expectedUpdatedAt: baseDraft.updatedAt, privacyMode: availability?.privacyMode, playlistId: action === "from_playlist" ? playlistId : undefined, externalConfirmation }) });
      setStage("Validating proposal locally"); const body = await readRecipeCopilotResponse(response, "Recipe Copilot failed.");
      const next = body.proposal; setProposal(next); setEditedRecipe(next.proposedRecipe ? clone(next.proposedRecipe) : null); setSelected(new Set((next.changes || []).map((item: any) => stableRecipeProposalChangeId(next.id, item.path)))); setInvalidEditPaths(new Set()); setApprovedConfirm(false); setStage("Ready for review");
    } catch (caught) { if ((caught as Error).name === "AbortError") { setErrorCode("REQUEST_CANCELLED"); setErrorRequestId(null); setErrorDetails(null); setError("Request cancelled. The current Recipe Studio draft was preserved."); } else { const code = String((caught as any)?.code || "AI_RECIPE_REQUEST_FAILED"); setErrorCode(code); setErrorRequestId(caught instanceof RecipeCopilotHttpError ? caught.requestId || null : null); setErrorDetails(caught instanceof RecipeCopilotHttpError ? caught.details || null : null); setError(recipeCopilotErrorMessage(code, caught instanceof Error ? caught.message : "Recipe Copilot failed.", true)); } setStage("Failed"); }
    finally { setRunning(false); abort.current = null; }
  }

  function cancel() { abort.current?.abort(); setStage("Cancelling request"); }
  function editChange(path: string, raw: string) {
    try {
      const existing = getRecipeProposalPath(editedRecipe, path);
      const value = typeof existing === "string" ? raw : JSON.parse(raw);
      setEditedRecipe((current) => { const next = clone(current || {}); setPath(next, path, value); return next; });
      if (path === "scoring.scoringModel" && !(SCORING_MODELS as readonly string[]).includes(String(value))) {
        setInvalidEditPaths((current) => new Set(current).add(path));
        setErrorCode("AI_RECIPE_PROPOSAL_UNSUPPORTED_ENUM");
        setErrorDetails({ issues: [{ path, receivedValue: value, supportedValues: SCORING_MODELS }] });
        setError("Recipe Copilot proposed an unsupported scoring model.");
        return;
      }
      setInvalidEditPaths((current) => { const next = new Set(current); next.delete(path); return next; });
      setErrorCode(null); setErrorDetails(null); setError("");
    } catch {
      setInvalidEditPaths((current) => new Set(current).add(path));
      setError(`The proposed value for ${path} must be valid JSON.`);
    }
  }
  function toggle(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }

  async function applySelected(resolutions: Record<string, RecipeProposalConflictResolution> = {}) {
    if (applyingRef.current) return;
    if (!proposal?.id || selectedChanges.length === 0) {
      setErrorCode("AI_RECIPE_PROPOSAL_NO_CHANGES_SELECTED");
      setError("Select at least one Recipe Copilot change.");
      return;
    }
    if (!onApplyChanges) {
      setErrorCode("AI_RECIPE_PROPOSAL_FORM_UNAVAILABLE");
      setError("Recipe Studio is unavailable. Reopen the recipe and try again.");
      return;
    }
    const selectedInvalidPaths = selectedChanges.map((change) => change.path).filter((path) => invalidEditPaths.has(path));
    if (selectedInvalidPaths.length > 0) {
      setErrorCode("AI_RECIPE_PROPOSAL_PATCH_FAILED");
      setError(`Correct the invalid proposed value for ${selectedInvalidPaths.join(", ")} before applying.`);
      return;
    }
    applyingRef.current = true;
    setApplying(true);
    setError("");
    setErrorCode(null);
    setStage("Applying reviewed changes");
    const startedAt = performance.now();
    const selectedPaths = selectedChanges.map((change) => change.path);
    if (process.env.NODE_ENV !== "production") {
      console.debug("[Recipe Copilot] Applying selected changes", {
        proposalId: proposal.id,
        totalChangeCount: reviewChanges.length,
        selectedChangeCount: selectedChanges.length,
        selectedPaths,
      });
    }
    try {
      const result = await onApplyChanges({
        proposalId: proposal.id,
        baseRevision: proposal.baseRevision || null,
        changes: selectedChanges,
        conflictResolutions: resolutions,
      });
      if (!result.success) {
        if (result.errorCode === "AI_RECIPE_PROPOSAL_CONFLICT" && result.conflicts?.length) {
          const nextResolutions = Object.fromEntries(result.conflicts.map((conflict) => [conflict.path, "keep_current"])) as Record<string, RecipeProposalConflictResolution>;
          setApplyConflicts(result.conflicts);
          setConflictResolutions(nextResolutions);
          setErrorCode("AI_RECIPE_PROPOSAL_CONFLICT");
          setError("Review the conflicting fields and choose whether to keep your edits or use the Recipe Copilot values.");
          setStage("Conflict resolution required");
          return;
        }
        const path = result.validationIssues?.[0]?.path;
        throw Object.assign(new Error(result.errorMessage || (path ? `Could not apply ${path}.` : "The updated draft did not pass Recipe Studio validation.")), {
          code: result.errorCode || "AI_RECIPE_PROPOSAL_APPLY_FAILED",
          details: result.validationIssues ? { issues: result.validationIssues } : undefined,
        });
      }
      setApplyConflicts([]);
      const alreadyApplied = result.alreadyAppliedCount ? ` ${result.alreadyAppliedCount} selected change${result.alreadyAppliedCount === 1 ? " was" : "s were"} already present.` : "";
      setStage(`Applied ${result.appliedCount} change${result.appliedCount === 1 ? "" : "s"} to the draft`);
      onNotice(`Applied ${result.appliedCount} Recipe Copilot change${result.appliedCount === 1 ? "" : "s"} to the draft.${alreadyApplied} Review the recipe and save when ready.`);
      onClose();
    } catch (caught) {
      const code = String((caught as any)?.code || "AI_RECIPE_PROPOSAL_APPLY_FAILED");
      const message = caught instanceof Error ? caught.message : "The updated draft did not pass Recipe Studio validation.";
      setErrorCode(code);
      setErrorDetails((caught as any)?.details || null);
      setError(`Your proposal is still available. No recipe fields were changed. ${message}`);
      setStage("Ready for review");
      console.error("[Recipe Copilot] Failed to apply selected changes", {
        proposalId: proposal.id,
        selectedCount: selectedChanges.length,
        failedPaths: selectedPaths,
        errorCode: code,
        exceptionClass: caught instanceof Error ? caught.name : "Unknown",
        sanitizedMessage: message.slice(0, 500),
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    } finally {
      applyingRef.current = false;
      setApplying(false);
    }
  }

  async function operate(operation: string, body: Record<string, unknown> = {}) {
    if (!proposal) return; setError(""); setStage(operation === "apply" ? "Applying reviewed changes" : `${operation[0].toUpperCase()}${operation.slice(1)} proposal`);
    try {
      const response = await fetch(`/api/recipes/ai/proposals/${encodeURIComponent(proposal.id)}/${operation}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation === "apply" ? { ...body, currentRecipe: draft } : body) });
      const result = await readRecipeCopilotResponse(response, `Could not ${operation} proposal.`);
      if (result.proposal) setProposal(result.proposal);
      if (operation === "restore" && result.recipe) { onDraft(result.recipe, true); onNotice("The pre-AI recipe state was restored as a new inactive revision."); }
      if (operation === "reject") setSelected(new Set());
      setStage("Ready for review");
    } catch (caught) { setError(caught instanceof Error ? caught.message : `Could not ${operation} proposal.`); setStage("Ready for review"); }
  }

  async function loadHistory() {
    try { const response = await fetch(recipeId ? `/api/recipes/${encodeURIComponent(recipeId)}/ai/history` : "/api/recipes/ai?view=history"); const body = await readRecipeCopilotResponse(response, "History unavailable."); setHistory(body.proposals || []); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "History unavailable."); }
  }

  if (!open) return null;
  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !running && !applying) onClose(); }}>
    <aside ref={dialog} className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="recipe-copilot-title" aria-describedby="recipe-copilot-description">
      <header className={styles.header}><div><span><Sparkles size={15} /> AI generated · review required</span><h2 id="recipe-copilot-title">Recipe Copilot</h2><p id="recipe-copilot-description">Advisory help inside Recipe Studio. Nothing is approved or activated automatically.</p></div><button type="button" ref={closeButton} onClick={onClose} disabled={running || applying} aria-label="Close Recipe Copilot"><X size={19} /></button></header>
      <div className={styles.body}>
        <div className={styles.context}><strong>{sourceLabel}</strong><span>{availability?.providerName || availability?.provider || "Provider not configured"} · {availability?.modelName || availability?.model || "Model not configured"}</span><span>{availability?.privacyMode?.replaceAll("_", " ") || "Checking privacy"} · {availability?.available ? availability?.remoteOperationAllowed ? "Ready · remote operation" : "Ready · local operation" : isRecipeCopilotSetupError(availability?.blockedReasonCode || availability?.code) ? "Setup required" : availability?.blockedReasonCode || availability?.code ? "Blocked by policy" : "Checking authorization"}</span></div>
        <label className={styles.field}><span>Copilot action</span><select value={action} onChange={(event) => { setAction(event.target.value as Action); setProposal(null); setApplyConflicts([]); setConflictResolutions({}); }} aria-label="Recipe Copilot action">{actions.map((item) => <option key={item.id} value={item.id}>{item.label} — {item.hint}</option>)}</select></label>
        <label className={styles.field}><span>Instruction</span><textarea rows={4} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder={action === "create" ? "Create a relaxing work playlist with mostly familiar music and a few discoveries." : action === "refine" ? "Reduce artist repetition without changing the purpose." : "What should Copilot focus on?"} maxLength={6000} /></label>
        {action === "from_playlist" && <label className={styles.field}><span>Example playlist</span><select value={playlistId} onChange={(event) => setPlaylistId(event.target.value)}><option value="">Choose an existing playlist</option>{playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.name} ({playlist.tracks} tracks)</option>)}</select><small>Mixarr sends aggregate characteristics, not the playlist’s track list.</small></label>}
        {action === "optimize" && <label className={styles.purpose}><span>Presumed purpose — correct this before optimizing</span><textarea rows={3} value={purpose} onChange={(event) => setPurpose(event.target.value)} /></label>}
        <section className={styles.preflight} aria-live="polite" aria-busy={preflightState === "loading"}>{preflightState === "loading" ? <><Loader2 className="animate-spin" size={16} /> Checking provider, privacy, policy, and cost…</> : availability?.available ? <><CheckCircle2 size={17} /><div><strong>Ready · {availability.providerName || availability.provider} · {availability.modelName || availability.model}</strong><span>Estimated input: about {Number(availability.estimatedInputTokens || 0).toLocaleString()} tokens · Output length managed by provider</span><span>Structured output: {String(availability.structuredOutputMode || "prompt_only_json").replaceAll("_", " ")}</span><span>{availability.local ? "Local cost is governed locally" : `Estimated ${availability.currency || "USD"} ${Number(availability.estimatedCost || 0).toFixed(4)}`}</span><span>No track-level library metadata is included.</span><span>{recipeCopilotDailyRequestSummary(availability.dailyRequestLimit)}</span></div></> : <><ShieldAlert size={17} /><div><strong>{isRecipeCopilotSetupError(availability?.blockedReasonCode || availability?.code) ? "Setup required" : "Request blocked"}</strong><span>{recipeCopilotErrorMessage(availability?.blockedReasonCode || availability?.code, availability?.blockedReasonMessage || availability?.reason || "Recipe Copilot is unavailable.", false)}</span><code>{availability?.blockedReasonCode || availability?.code}{availability?.failedCheck ? ` · failed check: ${availability.failedCheck}` : ""}</code>{availability?.canConfigure && availability?.settingsUrl && <a href={availability.settingsUrl}>{isRecipeCopilotRequestLimitError(availability?.blockedReasonCode || availability?.code) ? "Open AI request limits" : isRecipeCopilotCostLimitError(availability?.blockedReasonCode || availability?.code) ? "Open AI cost limits" : "Open AI provider settings"}</a>}</div></>}</section>
        {availability?.available && availability.modelReasoning && <section className={styles.preflight} role="status"><AlertTriangle size={17}/><div><strong>Model reasoning</strong><span>This model supports internal reasoning. Mixarr disables reasoning for structured Recipe Copilot requests to improve JSON reliability. The provider manages final output length.</span></div></section>}
        <div className={styles.actions}><button className={styles.generate} disabled={!canRequest} onClick={() => void generate()}>{running ? <Loader2 className="animate-spin" size={16} /> : <Sparkles size={16} />} {running ? stage : action === "explain" || action === "diagnose" ? "Analyze" : "Generate"}</button>{running && <button onClick={cancel}>Cancel</button>}<button onClick={() => setPreflightVersion((value) => value + 1)} disabled={running}><RotateCcw size={15} /> Refresh</button><button onClick={() => void loadHistory()}><History size={15} /> History</button></div>
        {!canRequest && availability?.available && !running && ["create", "refine", "optimize", "compare_intent"].includes(action) && !instruction.trim() && <p className={styles.disabledReason}>Enter an instruction to continue.</p>}
        {!canRequest && availability?.available && !running && action === "from_playlist" && !playlistId && <p className={styles.disabledReason}>Choose an example playlist to continue.</p>}
        {error && <div className={styles.error} role="alert"><AlertTriangle size={17} /><span>{errorCode === "AI_RECIPE_PROPOSAL_CONFLICT" && <strong>Some recipe fields changed after this proposal was created</strong>}{errorCode === "AI_RECIPE_PROPOSAL_APPLY_FAILED" && <strong>Could not apply the Recipe Copilot changes</strong>}{errorCode === "AI_RECIPE_PROPOSAL_UNSUPPORTED_ENUM" && <strong>Recipe Copilot proposed an unsupported scoring model.</strong>}{["AI_FEATURE_INVALID_JSON_OUTPUT", "AI_FEATURE_INVALID_STRUCTURED_OUTPUT", "AI_FEATURE_STRUCTURED_REPAIR_FAILED"].includes(errorCode || "") && <strong>Recipe Copilot returned an incompatible draft</strong>}{error}{errorDetails?.issues?.[0]?.path && <small>Field: {errorDetails.issues[0].path === "scoring.scoringModel" || String(errorDetails.issues[0].path).endsWith("scoring.scoringModel") ? "Scoring model" : errorDetails.issues[0].path}</small>}{errorDetails?.issues?.[0]?.receivedValue !== undefined && <small>Proposed value: {String(errorDetails.issues[0].receivedValue)}</small>}{errorDetails?.issues?.[0]?.supportedValues && <small>Supported choices: {errorDetails.issues[0].supportedValues.join(", ")}</small>}{errorCode === "AI_RECIPE_PROPOSAL_UNSUPPORTED_ENUM" && <small>Regenerate the proposal or choose a supported model.</small>}{errorDetails && !errorDetails.issues?.[0]?.supportedValues && <small>{errorDetails.provider || availability?.provider || "Provider"} · {errorDetails.model || availability?.model || "Model"} · JSON parsed: {errorDetails.jsonParsed ? "yes" : "no"} · Normalized: {errorDetails.normalized ? "yes" : "no"} · Repair attempted: {errorDetails.repairAttempted ? "yes" : "no"}</small>}{errorCode && <code>{errorCode}</code>}{errorRequestId && <small>Request ID: {errorRequestId}</small>}</span></div>}
        {stage && <p className={styles.stage} role="status" aria-live="polite">{stage}</p>}

        {proposal && <div className={styles.results}>
          {Array.isArray(proposal.analysis?.warnings) && proposal.analysis.warnings.some((warning: string) => warning.includes("automatic format correction")) && <section className={styles.preflight} role="status"><CheckCircle2 size={17}/><div><strong>Automatic format correction applied</strong><span>The provider response required automatic format correction. Review the draft before applying it.</span></div></section>}
          <section className={styles.reviewHeader}><div><span className={styles.badge} data-status={proposal.status}>{proposal.status.replaceAll("_", " ")}</span>{proposal.manuallyEdited && <span className={styles.badge}>Manually edited</span>}</div><strong>{proposal.intent?.summary || "Copilot analysis"}</strong><small>Confidence {Math.round(Number(proposal.confidence || 0) * 100)}% · Validated does not mean approved or active.</small></section>
          <RecommendationExplanationPanel resourceId={proposal.id} title="Full recommendation explanation" />
          {(proposal.intent?.conflicts || []).length > 0 && <ResultList title="Intent conflicts" items={proposal.intent.conflicts.map((item: any) => `${item.description} Resolution: ${item.resolution}`)} warning />}
          {(proposal.safetyWarnings || []).length > 0 && <ResultList title="Warnings and safety" items={proposal.safetyWarnings} warning />}
          {(proposal.unsupportedRequests || []).length > 0 && <ResultList title="Unsupported requests" items={proposal.unsupportedRequests} warning />}
          {proposal.candidateEstimate && <section className={styles.metrics}><h3>Local candidate estimate</h3><div><span>Matching</span><strong>{proposal.candidateEstimate.matchingCandidates ?? "Unknown"}</strong></div><div><span>Requested</span><strong>{proposal.candidateEstimate.requestedPlaylistSize}</strong></div><div><span>Unique artists</span><strong>{proposal.candidateEstimate.uniqueArtists ?? "Unknown"}</strong></div><div><span>Achievable</span><strong>{proposal.candidateEstimate.achievable ? "Likely" : "Unlikely"}</strong></div><small>Estimated locally; no track list was sent to the AI provider.</small></section>}
          {resultSections.explanation && <section className={styles.prose}><h3>Explanation</h3><p>{resultSections.explanation.summary}</p><details><summary>Detailed explanation</summary>{resultSections.explanation.detailed.map((item: any) => <div key={item.section}><strong>{item.section}</strong><p>{item.explanation}</p>{item.surprises?.map((value: string) => <small key={value}>May surprise you: {value}</small>)}</div>)}</details></section>}
          {(resultSections.diagnoses || []).map((item: any) => <section className={styles.diagnosis} key={`${item.category}-${item.likelyCause}`}><h3>{item.category}</h3><p>{item.likelyCause}</p><small>Confidence {Math.round(item.confidence * 100)}% · {item.affectedRules.join(", ") || "No specific rule"}</small>{item.suggestedCorrections.map((fix: any) => <div key={`${fix.path}-${fix.suggestion}`}><strong>{fix.path}</strong><span>{fix.suggestion}</span><small>{fix.changesPurpose ? "Changes purpose" : "Preserves purpose"} · {fix.locallyValidatable ? "Locally validatable" : "Requires further evaluation"}</small></div>)}</section>)}
          {resultSections.behaviorComparison && <><ResultList title="Matches intent" items={resultSections.behaviorComparison.matches} /><ResultList title="Contradictions" items={resultSections.behaviorComparison.contradictions} warning /><ResultList title="Missing rules" items={resultSections.behaviorComparison.missingRules} /></>}
          {(resultSections.nameSuggestions || []).length > 0 && <section className={styles.prose}><h3>Name suggestions</h3>{resultSections.nameSuggestions.map((item: any) => <button className={styles.name} key={item.name} onClick={() => onDraft({ ...draft, name: item.name })}><strong>{item.name}</strong><span>{item.rationale} · {item.style}</span></button>)}</section>}
          {(resultSections.onboarding || []).length > 0 && <section className={styles.prose}><h3>Onboarding guidance</h3>{resultSections.onboarding.map((item: any) => <div key={item.title}><strong>{item.title}</strong><p>{item.guidance}</p></div>)}</section>}
          {(proposal.recommendations?.parentRecipes || []).length > 0 && <section className={styles.prose}><h3>Parent and inheritance recommendations</h3>{proposal.recommendations.parentRecipes.map((item: any) => <div key={item.id}><strong>{item.name}</strong><p>{item.reason}</p><small>{item.maintenanceBenefit} Parent attachment is never automatic.</small></div>)}</section>}
          {applyConflicts.length > 0 && <section className={styles.conflicts} aria-labelledby="recipe-conflicts-title"><h3 id="recipe-conflicts-title">Resolve conflicting fields</h3>{applyConflicts.map((conflict) => <article key={conflict.path}><h4>{conflict.label}</h4><dl><div><dt>When proposal was generated</dt><dd>{display(conflict.baseValue)}</dd></div><div><dt>My current value</dt><dd>{display(conflict.currentValue)}</dd></div><div><dt>Recipe Copilot proposal</dt><dd>{display(conflict.proposedValue)}</dd></div></dl><fieldset><legend>Resolution</legend><label><input type="radio" name={`conflict-${conflict.path}`} checked={(conflictResolutions[conflict.path] || "keep_current") === "keep_current"} onChange={() => setConflictResolutions((current) => ({ ...current, [conflict.path]: "keep_current" }))} /> Keep my current value</label><label><input type="radio" name={`conflict-${conflict.path}`} checked={conflictResolutions[conflict.path] === "use_proposed"} onChange={() => setConflictResolutions((current) => ({ ...current, [conflict.path]: "use_proposed" }))} /> Use Copilot proposal</label></fieldset></article>)}<div className={styles.applyBar}><button type="button" disabled={applying || selectedChanges.length === applyConflicts.length} onClick={() => void applySelected(Object.fromEntries(applyConflicts.map((conflict) => [conflict.path, "keep_current"])))}>Apply non-conflicting changes</button><button type="button" disabled={applying} onClick={() => void applySelected(conflictResolutions)}>Apply chosen resolutions</button><button type="button" className={styles.generate} disabled={applying} onClick={() => void applySelected(Object.fromEntries(applyConflicts.map((conflict) => [conflict.path, "use_proposed"])))}>Use selected Copilot values</button><button type="button" disabled={applying} onClick={() => { setApplyConflicts([]); setConflictResolutions({}); onClose(); }}>Cancel and continue editing</button></div></section>}
          {changes.length > 0 && <section className={styles.changes}><header><div><h3>Review proposed changes</h3><small>{selectedChanges.length} of {changes.length} selected</small></div><button type="button" disabled={applying} onClick={() => setSelected(allSelected ? new Set() : new Set(reviewChanges.map((item) => item.id)))}>{allSelected ? "Reject all" : "Accept all"}</button></header>{changes.map((change: any) => { const id = stableRecipeProposalChangeId(proposal.id, change.path); const baseValue = proposal.baseDraft ? getRecipeProposalPath(proposal.baseDraft, change.path) : change.before; return <article key={id} data-selected={selected.has(id)}><label><input type="checkbox" checked={selected.has(id)} disabled={applying} onChange={() => toggle(id)} /><span><strong>{change.path}</strong><small>{change.section}</small></span></label><dl><div><dt>Current rule</dt><dd>{display(baseValue)}</dd></div><div><dt>Proposed rule</dt><dd><input aria-label={`Proposed value for ${change.path}`} defaultValue={typeof change.after === "string" ? change.after : JSON.stringify(change.after)} disabled={applying} onBlur={(event) => editChange(change.path, event.target.value)} /></dd></div></dl><p>{change.reason}</p><small>Expected: {change.expectedBehaviorChange}</small>{change.potentialSideEffects?.length > 0 && <small>Side effects: {change.potentialSideEffects.join("; ")}</small>}<small>Confidence {Math.round(change.confidence * 100)}%</small></article>; })}</section>}
          {applyConflicts.length === 0 && <div className={styles.applyBar}>{changes.length > 0 && <button type="button" className={styles.generate} disabled={selectedChanges.length === 0 || applying || proposalUnavailable || proposalTypeStale || selectedChanges.some((change) => invalidEditPaths.has(change.path)) || !onApplyChanges} title={selectedChanges.length === 0 ? "Select at least one change." : applying ? "Recipe Copilot changes are already being applied." : proposalUnavailable ? "This proposal is no longer available." : proposalTypeStale ? "The recipe type changed. Regenerate the proposal." : selectedChanges.some((change) => invalidEditPaths.has(change.path)) ? "Correct invalid proposed values before applying." : !onApplyChanges ? "Recipe Studio is unavailable." : undefined} onClick={() => void applySelected()}>{applying ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />} {applying ? "Applying…" : "Apply selected"}</button>}<button type="button" disabled={applying} onClick={() => void operate("reject", { reason: "Rejected during Recipe Studio review." })}>Reject proposal</button>{proposal.recipeId && proposal.appliedAt && <button type="button" disabled={applying} onClick={() => void operate("restore")}><RotateCcw size={15} /> Restore previous</button>}{proposal.status === "NEEDS_REVIEW" || proposal.status === "QUARANTINED" ? <button type="button" disabled={applying} onClick={() => void operate("validate")}>Revalidate</button> : null}</div>}
          {changes.length > 0 && selectedChanges.length === 0 && <p className={styles.disabledReason}>Select at least one valid change to apply it to the Recipe Studio draft.</p>}
          {proposalUnavailable && <p className={styles.disabledReason}>This proposal is unavailable, expired, rejected, superseded, or quarantined.</p>}
          {proposalTypeStale && <p className={styles.disabledReason}>The recipe type changed while this proposal was open. Regenerate the proposal before applying it.</p>}
          {proposal.status === "VALIDATED" && <section className={styles.approval}><label><input type="checkbox" checked={approvedConfirm} onChange={(event) => setApprovedConfirm(event.target.checked)} /> <span>{approvalConfirmation}</span></label><button disabled={!approvedConfirm} onClick={() => void operate("approve", { confirmation: approvalConfirmation })}>Approve after review</button><small>Administrator permission is required. Approval leaves the recipe inactive.</small></section>}
        </div>}
        {history && <section className={styles.history}><header><h3>AI request history</h3><button onClick={() => setHistory(null)}><ChevronDown size={15} /> Hide</button></header>{history.length ? history.map((item) => <button key={item.id} onClick={() => { setProposal(item); setEditedRecipe(item.proposedRecipe ? clone(item.proposedRecipe) : null); setSelected(new Set((item.changes || []).map((change: any) => stableRecipeProposalChangeId(item.id, change.path)))); setInvalidEditPaths(new Set()); setApplyConflicts([]); setConflictResolutions({}); setError(""); setErrorCode(null); }}><Clock3 size={15} /><span><strong>{item.request?.action?.replaceAll("_", " ")}</strong><small>{item.status.replaceAll("_", " ")} · {new Date(item.createdAt).toLocaleString()}</small></span></button>) : <p>No Recipe Copilot history yet.</p>}</section>}
      </div>
    </aside>
  </div>;
}

function ResultList({ title, items, warning = false }: { title: string; items: string[]; warning?: boolean }) {
  if (!items?.length) return null;
  return <section className={warning ? styles.warningList : styles.list}><h3>{title}</h3><ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul></section>;
}
