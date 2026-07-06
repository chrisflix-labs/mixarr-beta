"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import axios from "axios";
import { AlertCircle, BookMarked, CheckCircle2, Copy, Download, Edit3, Play, RefreshCw, Trash2, Upload, Wand2 } from "lucide-react";
import styles from "./recipes.module.css";

type PlaylistRecipe = {
  id: string;
  name: string;
  description?: string | null;
  filterSummary: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string | null;
  useCount: number;
};

type ImportPreviewRecipe = {
  index: number;
  name: string;
  description?: string | null;
  filterSummary: string;
  smartPresetName?: string | null;
  moodPresetName?: string | null;
  bpmPresetName?: string | null;
  warnings: string[];
  errors: string[];
  hasConflict: boolean;
  proposedName: string;
};

type ImportPreview = {
  recipeCount: number;
  validCount: number;
  invalidCount: number;
  recipes: ImportPreviewRecipe[];
};

type ImportSummary = {
  imported: number;
  renamed: number;
  skipped: number;
  failed: number;
  failures: { index: number; name: string; reason: string }[];
};

function formatDate(value?: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function downloadBlob(data: BlobPart, filename: string) {
  const blob = new Blob([data], { type: "application/json" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function filenameFromContentDisposition(header?: string, fallback = "mixarr-recipes-export.json") {
  const match = header?.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallback;
}

function importSummaryText(summary: ImportSummary) {
  const parts = [
    `Imported ${summary.imported} recipe${summary.imported === 1 ? "" : "s"}.`,
    `${summary.renamed} duplicate${summary.renamed === 1 ? " was" : "s were"} renamed.`,
    `${summary.skipped} recipe${summary.skipped === 1 ? "" : "s"} skipped.`,
  ];
  if (summary.failed > 0) parts.push(`${summary.failed} recipe${summary.failed === 1 ? "" : "s"} could not be imported.`);
  return parts.join(" ");
}

export default function RecipesPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [recipes, setRecipes] = useState<PlaylistRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [duplicatingRecipeId, setDuplicatingRecipeId] = useState("");
  const [exportingRecipeId, setExportingRecipeId] = useState("");
  const [exportingAll, setExportingAll] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmingImport, setConfirmingImport] = useState(false);
  const [importFileName, setImportFileName] = useState("");
  const [importContent, setImportContent] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importSummary, setImportSummary] = useState<ImportSummary | null>(null);
  const [conflictStrategy, setConflictStrategy] = useState<"rename" | "skip">("rename");
  const [error, setError] = useState("");
  const [importError, setImportError] = useState("");

  const fetchRecipes = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await axios.get("/api/playlist-recipes");
      setRecipes(res.data.recipes || []);
    } catch (e) {
      console.error(e);
      setError("Unable to load playlist recipes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRecipes();
  }, []);

  const exportRecipe = async (recipe: PlaylistRecipe) => {
    setExportingRecipeId(recipe.id);
    try {
      const res = await axios.get(`/api/playlist-recipes/${recipe.id}/export`, { responseType: "text" });
      downloadBlob(res.data, filenameFromContentDisposition(res.headers["content-disposition"], `mixarr-recipe-${recipe.id}.json`));
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.error || "Failed to export playlist recipe");
    } finally {
      setExportingRecipeId("");
    }
  };

  const exportAllRecipes = async () => {
    setExportingAll(true);
    try {
      const res = await axios.get("/api/playlist-recipes/export", { responseType: "text" });
      downloadBlob(res.data, filenameFromContentDisposition(res.headers["content-disposition"]));
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.error || "Failed to export playlist recipes");
    } finally {
      setExportingAll(false);
    }
  };

  const clearImport = () => {
    setImportFileName("");
    setImportContent("");
    setImportPreview(null);
    setImportSummary(null);
    setImportError("");
    setConflictStrategy("rename");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const previewImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    clearImport();
    if (!file) return;

    setImportFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".json")) {
      setImportError("This does not look like a valid Mixarr recipe export.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setImportError("Recipe import file is too large.");
      return;
    }

    setImporting(true);
    try {
      const content = await file.text();
      const res = await axios.post("/api/playlist-recipes/import/preview", { content });
      setImportContent(content);
      setImportPreview(res.data.preview);
    } catch (e: any) {
      console.error(e);
      setImportError(e.response?.data?.error || "This does not look like a valid Mixarr recipe export.");
    } finally {
      setImporting(false);
    }
  };

  const confirmImport = async () => {
    if (!importContent || !importPreview) return;
    setConfirmingImport(true);
    setImportError("");
    setImportSummary(null);
    try {
      const res = await axios.post("/api/playlist-recipes/import", {
        content: importContent,
        conflictStrategy,
      });
      setImportSummary(res.data.summary);
      await fetchRecipes();
    } catch (e: any) {
      console.error(e);
      setImportError(e.response?.data?.error || "Failed to import playlist recipes.");
    } finally {
      setConfirmingImport(false);
    }
  };

  const deleteRecipe = async (recipe: PlaylistRecipe) => {
    if (!window.confirm(`Delete recipe "${recipe.name}"? This cannot be undone.`)) return;
    try {
      await axios.delete(`/api/playlist-recipes/${recipe.id}`);
      setRecipes(recipes.filter((item) => item.id !== recipe.id));
    } catch (e) {
      console.error(e);
      alert("Failed to delete playlist recipe");
    }
  };

  const duplicateRecipe = async (recipe: PlaylistRecipe) => {
    setDuplicatingRecipeId(recipe.id);
    try {
      const res = await axios.post(`/api/playlist-recipes/${recipe.id}/duplicate`);
      alert(res.data.message || `Duplicated recipe "${recipe.name}".`);
      router.push(`/builder?recipeId=${res.data.recipe.id}&edit=1`);
    } catch (e: any) {
      console.error(e);
      alert(e.response?.data?.error || "Failed to duplicate playlist recipe");
    } finally {
      setDuplicatingRecipeId("");
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>
            <BookMarked size={14} />
            Saved Recipes
          </span>
          <h2>Playlist Recipes</h2>
          <p>Save, reuse, export, and import playlist builder filter setups.</p>
        </div>
        <div className={styles.headerActions}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className={styles.fileInput}
            onChange={previewImportFile}
          />
          <button type="button" onClick={() => fileInputRef.current?.click()} className={styles.secondaryButton}>
            <Upload size={16} />
            Import Recipes
          </button>
          <button type="button" onClick={exportAllRecipes} disabled={exportingAll || recipes.length === 0} className={styles.secondaryButton}>
            {exportingAll ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
            Export All Recipes
          </button>
          <Link href="/builder" className={styles.primaryButton}>
            <Wand2 size={16} />
            Build Playlist
          </Link>
          <Link href="/smart-builder" className={styles.secondaryButton}>
            <Wand2 size={16} />
            Create Smart Recipe
          </Link>
        </div>
      </header>

      {(importing || importFileName || importPreview || importError || importSummary) && (
        <section className={styles.importPanel} aria-label="Import recipe preview">
          <div className={styles.importPanelTop}>
            <div>
              <span className={styles.kicker}>
                <Upload size={14} />
                Import Recipes
              </span>
              <h3>{importFileName || "Selected recipe export"}</h3>
            </div>
            <button type="button" onClick={clearImport} className={styles.secondaryButton}>Clear</button>
          </div>

          {importing && <p className={styles.importStatus}>Validating recipe export...</p>}
          {importError && (
            <div className={styles.importError}>
              <AlertCircle size={16} />
              {importError}
            </div>
          )}
          {importSummary && (
            <div className={styles.importSuccess}>
              <CheckCircle2 size={16} />
              <span>{importSummaryText(importSummary)}</span>
            </div>
          )}
          {importSummary?.failures?.length ? (
            <ul className={styles.failureList}>
              {importSummary.failures.map((failure) => (
                <li key={`${failure.index}-${failure.reason}`}>{failure.name}: {failure.reason}</li>
              ))}
            </ul>
          ) : null}

          {importPreview && (
            <>
              <div className={styles.importStats}>
                <span>{importPreview.recipeCount} found</span>
                <span>{importPreview.validCount} valid</span>
                <span>{importPreview.invalidCount} with errors</span>
              </div>

              <div className={styles.conflictOptions} aria-label="Duplicate recipe name handling">
                <label>
                  <input
                    type="radio"
                    name="conflictStrategy"
                    value="rename"
                    checked={conflictStrategy === "rename"}
                    onChange={() => setConflictStrategy("rename")}
                  />
                  Rename imported recipes automatically
                </label>
                <label>
                  <input
                    type="radio"
                    name="conflictStrategy"
                    value="skip"
                    checked={conflictStrategy === "skip"}
                    onChange={() => setConflictStrategy("skip")}
                  />
                  Skip duplicates
                </label>
              </div>

              <div className={styles.previewList}>
                {importPreview.recipes.map((recipe) => (
                  <article key={recipe.index} className={styles.previewRecipe} data-invalid={recipe.errors.length > 0}>
                    <div>
                      <h4>{recipe.name}</h4>
                      {recipe.description && <p>{recipe.description}</p>}
                      {recipe.hasConflict && (
                        <small>
                          Duplicate name: {conflictStrategy === "rename" ? `will save as "${recipe.proposedName}"` : "will be skipped"}
                        </small>
                      )}
                    </div>
                    <div className={styles.previewBadges}>
                      {recipe.smartPresetName && <span>Smart: {recipe.smartPresetName}</span>}
                      {recipe.moodPresetName && <span>Mood: {recipe.moodPresetName}</span>}
                      {recipe.bpmPresetName && <span>BPM: {recipe.bpmPresetName}</span>}
                    </div>
                    {recipe.filterSummary && <p className={styles.summary}>{recipe.filterSummary}</p>}
                    {recipe.warnings.map((warning) => (
                      <p key={warning} className={styles.warningText}>{warning}</p>
                    ))}
                    {recipe.errors.map((recipeError) => (
                      <p key={recipeError} className={styles.errorText}>{recipeError}</p>
                    ))}
                  </article>
                ))}
              </div>

              <div className={styles.importActions}>
                <button
                  type="button"
                  onClick={confirmImport}
                  disabled={confirmingImport || importPreview.validCount === 0}
                  className={styles.primaryButton}
                >
                  {confirmingImport ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                  Confirm Import
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {loading ? (
        <div className={styles.statePanel}>Loading playlist recipes...</div>
      ) : error ? (
        <div className={styles.statePanel}>{error}</div>
      ) : recipes.length === 0 ? (
        <section className={styles.emptyState}>
          <BookMarked size={28} />
          <h3>No playlist recipes saved yet.</h3>
          <p>Build a playlist, choose your filters, then save it as a recipe to reuse later.</p>
          <Link href="/builder" className={styles.primaryButton}>
            <Wand2 size={16} />
            Build Playlist
          </Link>
        </section>
      ) : (
        <section className={styles.recipeGrid} aria-label="Saved playlist recipes">
          {recipes.map((recipe) => (
            <article key={recipe.id} className={styles.recipeCard}>
              <div className={styles.cardTop}>
                <div>
                  <h3>{recipe.name}</h3>
                  {recipe.description && <p>{recipe.description}</p>}
                </div>
                <span>{recipe.useCount} use{recipe.useCount === 1 ? "" : "s"}</span>
              </div>

              <dl className={styles.metaGrid}>
                <div>
                  <dt>Created</dt>
                  <dd>{formatDate(recipe.createdAt)}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{formatDate(recipe.updatedAt)}</dd>
                </div>
                <div>
                  <dt>Last used</dt>
                  <dd>{formatDate(recipe.lastUsedAt)}</dd>
                </div>
              </dl>

              <p className={styles.summary}>{recipe.filterSummary || "No filters saved."}</p>

              <div className={styles.actions}>
                <Link href={`/builder?recipeId=${recipe.id}`} className={styles.secondaryButton}>
                  <Wand2 size={15} />
                  Use Recipe
                </Link>
                <Link href={`/builder?recipeId=${recipe.id}&preview=1`} className={styles.secondaryButton}>
                  <Play size={15} />
                  Preview
                </Link>
                <Link href={`/builder?recipeId=${recipe.id}&edit=1`} className={styles.secondaryButton}>
                  <Edit3 size={15} />
                  Edit
                </Link>
                <button type="button" onClick={() => duplicateRecipe(recipe)} disabled={duplicatingRecipeId === recipe.id} className={styles.secondaryButton}>
                  {duplicatingRecipeId === recipe.id ? <RefreshCw size={15} className="animate-spin" /> : <Copy size={15} />}
                  Duplicate
                </button>
                <button type="button" onClick={() => exportRecipe(recipe)} disabled={exportingRecipeId === recipe.id} className={styles.secondaryButton}>
                  {exportingRecipeId === recipe.id ? <RefreshCw size={15} className="animate-spin" /> : <Download size={15} />}
                  Export
                </button>
                <button type="button" onClick={() => deleteRecipe(recipe)} className={styles.dangerButton}>
                  <Trash2 size={15} />
                  Delete
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
