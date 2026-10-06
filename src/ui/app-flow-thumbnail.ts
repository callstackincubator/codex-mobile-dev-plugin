/** Canvas previews never retain a full-resolution decoded device screenshot. */
export async function flowThumbnail(blob: string, width: number) {
  const image = new Image();
  let canvas: HTMLCanvasElement | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(new Error('Screenshot decode failed.'));
      image.src = `data:image/png;base64,${blob}`;
    });
    canvas = document.createElement('canvas');
    canvas.width = Math.min(width, image.naturalWidth);
    canvas.height = Math.max(1, Math.round(image.naturalHeight * canvas.width / image.naturalWidth));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Screenshot preview is unavailable.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/png'), pixels = canvas.width * canvas.height;
    return {url, pixels, width, bytes: url.length * 2 + pixels * 4};
  } finally { if(canvas)canvas.width=canvas.height=0; image.onload = image.onerror = null; image.src = ''; }
}
