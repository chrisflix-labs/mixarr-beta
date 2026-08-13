import { tryCopyTextToClipboard, type CopyResult } from "./clipboard";

export type CreatedShareCode = {
  code: string;
  characterCount: number;
};

/**
 * Keeps share-code creation and clipboard copying as distinct outcomes. A
 * rejected copy never discards the successfully created code or invokes the
 * creator a second time.
 */
export async function createAndCopyShareCode(
  create: () => Promise<CreatedShareCode>,
  copy: (text: string) => Promise<CopyResult> = tryCopyTextToClipboard,
) {
  const created = await create();
  const copyResult = await copy(created.code);
  return { created, copyResult };
}
