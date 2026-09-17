declare module "pdfjs-dist" {
  type PdfPage = {
    getViewport(options: { scale: number }): { width: number; height: number };
    render(options: {
      canvas: HTMLCanvasElement;
      canvasContext: CanvasRenderingContext2D;
      viewport: { width: number; height: number };
    }): { promise: Promise<void> };
    cleanup(): void;
  };

  type PdfDocument = {
    numPages: number;
    getPage(pageNumber: number): Promise<PdfPage>;
    destroy(): Promise<void>;
  };

  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(options: { data: Uint8Array }): {
    promise: Promise<PdfDocument>;
  };
}
