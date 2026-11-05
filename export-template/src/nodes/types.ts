export type NodeStyle = {
  fill?: string;
  borderColor?: string;
  borderWidth?: number;
  borderStyle?: "solid" | "dashed" | "dotted";
  textColor?: string;
  fontWeight?: "normal" | "bold";
  fontSize?: number;
};

export type IllustrationPath = {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
};

/** Only path commands, numbers and separators: no markup can reach the DOM through `d`. */
export const PATH_D = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/;
export const COLOR = /^#[0-9a-fA-F]{3,8}$|^none$/;

export const safeColor = (c: string | undefined, fallback: string) => (c && COLOR.test(c) ? c : fallback);
