/** Load the packaged worker explicitly for both development and Electron ASAR. */
async function parserRuntime() {
  // The worker module supplies Node canvas globals before pdf.js is imported.
  // Keeping this lazy lets the workspace open even if a platform codec is absent.
  const { CanvasFactory, getData } = await import("pdf-parse/worker");
  const { PDFParse } = await import("pdf-parse");
  PDFParse.setWorker(getData());
  return { CanvasFactory, PDFParse };
}

export async function extractPDFText(data: Buffer): Promise<string> {
  const { CanvasFactory, PDFParse } = await parserRuntime();
  const parser = new PDFParse({ data, CanvasFactory });
  try {
    // `first` is the documented first-N-pages option in pdf-parse v2.
    const result = await parser.getText({ first: 200, pageJoiner: "" });
    if (!result.text.trim())
      return "[This PDF has no extractable text. OCR is not included; open the original or add a source summary.]";
    return (
      result.text +
      (result.total > 200
        ? "\n[Only the first 200 PDF pages were extracted.]"
        : "")
    );
  } finally {
    await parser.destroy();
  }
}
