/** Opens the browser's file chooser and resolves with the picked files (empty if cancelled). */
export const pickFiles = (accept: string, opts: { multiple?: boolean; directory?: boolean } = {}) =>
  new Promise<File[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = opts.multiple ?? true;
    if (opts.directory) input.webkitdirectory = true;
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.click();
  });
