// Starts a browser download of text as a file (P3-05, "Download JSON"). A Blob and a temporary link, the way every static
// page can save a file without a server; the object address is released afterwards. It may throw if the browser refuses.
export function downloadJson(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // Released after the browser has had time to start the download.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
