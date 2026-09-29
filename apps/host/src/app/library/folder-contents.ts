/**
 * The deep-count phrase shared by Folder tiles and the recursive-delete
 * confirm (issue #33): "7 documents in 3 folders", dropping an empty half.
 */
export function describeContents(documents: number, folders: number): string {
  const docs = `${documents} ${documents === 1 ? 'document' : 'documents'}`;
  if (folders === 0) return docs;
  const subfolders = `${folders} ${folders === 1 ? 'folder' : 'folders'}`;
  return documents === 0 ? subfolders : `${docs} in ${subfolders}`;
}
