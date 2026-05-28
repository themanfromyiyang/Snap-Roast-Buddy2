export type LayoutType = "receipt" | "big_text" | "pixel_expression" | "pixel_doodle";

export type RoastMode = "auto" | LayoutType;
export type RoastLevel = "gentle" | "normal" | "spicy";
export type Language = "zh" | "en";

export type RoastLayoutInput = {
  photoDescription: string;
  generatedComment?: string;
  mode?: RoastMode;
  roastLevel?: RoastLevel;
  language?: Language;
  printWidthDots?: number;
  returnLayoutJson?: boolean;
  skillDir?: string;
};

export type PhotoAnalysis = {
  sceneType: string;
  subjects: string[];
  mood: string;
  flaws: string[];
  funnyPoints: string[];
  visualKeywords: string[];
  roastPotential: number;
  chaosLevel: number;
  cutenessLevel: number;
  awkwardLevel: number;
  photoQualityIssues: string[];
  strongestPunchline?: string;
};

export type LayoutSkill = {
  name: string;
  layoutType: LayoutType;
  description?: string;
  triggerKeywords?: string[];
  tone?: RoastLevel | string;
  layoutRules?: Record<string, unknown>;
  contentSlots?: string[];
  visualMotifs?: string[];
  examples?: Array<Record<string, unknown>>;
  sourcePath?: string;
};

export type ReceiptContent = {
  title: string;
  subtitle: string;
  photoType: string;
  atmosphere: string;
  aiMood: string;
  findings: string[];
  scores: Array<{
    label: string;
    value: number;
  }>;
  roast: string;
  advice: string;
  verdict: string;
};

export type BigTextContent = {
  topLabel: string;
  headline: string;
  subHeadline?: string;
  oneLineRoast: string;
  tinyAdvice?: string;
};

export type PixelFaceType =
  | "cute_love"
  | "happy_proud"
  | "awkward_speechless"
  | "shocked_confused"
  | "angry_roast"
  | "sad_cry"
  | "begging_give"
  | "farewell";

export type PixelExpressionContent = {
  faceType: PixelFaceType;
  moodLabel: string;
  keywords: string[];
  shortComment: string;
};

export type LayoutDocument = {
  widthDots: number;
  heightDots?: number;
  background: "white";
  blocks: LayoutBlock[];
};

export type LayoutBlock =
  | TextBlock
  | RotatedTextBlock
  | DividerBlock
  | BarcodeLikeBlock
  | PixelArtBlock
  | SpacerBlock;

export type TextBlock = {
  type: "text";
  text: string;
  x: number;
  y: number;
  width: number;
  align: "left" | "center" | "right";
  fontSize: number;
  fontWeight?: "regular" | "bold";
  letterSpacing?: number;
  lineHeight?: number;
};

export type RotatedTextBlock = {
  type: "rotated_text";
  text: string;
  eyebrow?: string;
  subText?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  align: "center";
  fontSize: number;
  fontWeight?: "regular" | "bold";
  letterSpacing?: number;
};

export type DividerBlock = {
  type: "divider";
  x: number;
  y: number;
  width: number;
  style: "solid" | "dashed" | "double" | "thick";
};

export type BarcodeLikeBlock = {
  type: "barcode_like";
  x: number;
  y: number;
  width: number;
  height: number;
  pattern?: number[];
};

export type PixelArtBlock = {
  type: "pixel_art";
  matrix: string[];
  x: number;
  y: number;
  pixelSize: number;
};

export type SpacerBlock = {
  type: "spacer";
  height: number;
};

export type RoastLayoutOutput = {
  layoutType: LayoutType;
  content?: ReceiptContent | BigTextContent | PixelExpressionContent;
  textPreview: string;
  layoutJson: LayoutDocument;
  renderResult?: {
    svg?: string;
    imagePath?: string;
    escposBuffer?: Uint8Array;
  };
  reason: string;
};
