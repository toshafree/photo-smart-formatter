declare module "pica" {
  export type ResizeOptions = {
    quality?: 0 | 1 | 2 | 3;
    alpha?: boolean;
    unsharpAmount?: number;
    unsharpRadius?: number;
    unsharpThreshold?: number;
  };

  export type Pica = {
    resize(
      from: HTMLCanvasElement,
      to: HTMLCanvasElement,
      options?: ResizeOptions,
    ): Promise<HTMLCanvasElement>;
  };

  export default function pica(): Pica;
}
