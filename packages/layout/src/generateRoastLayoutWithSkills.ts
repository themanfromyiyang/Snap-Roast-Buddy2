import { analyzePhotoDescription } from "./analyzePhotoDescription.js";
import { generateLayoutDocument } from "./generateLayoutDocument.js";
import { generateRoastContent } from "./generateRoastContent.js";
import { renderSvgPreview } from "./renderSvgPreview.js";
import { renderTextPreview } from "./renderTextPreview.js";
import { explainLayoutChoice, selectLayoutType } from "./selectLayoutType.js";
import type { LayoutSkill, RoastLayoutInput, RoastLayoutOutput } from "./types.js";

export function generateRoastLayoutWithSkills(input: RoastLayoutInput, skills: LayoutSkill[] = []): RoastLayoutOutput {
  const printWidthDots = input.printWidthDots ?? 384;
  const analysis = analyzePhotoDescription(input.photoDescription);
  const layoutType = selectLayoutType(analysis, input.mode ?? "auto");
  const content = generateRoastContent(analysis, layoutType, input.roastLevel ?? "normal", skills, input.generatedComment);
  const layoutJson = generateLayoutDocument(content, layoutType, printWidthDots, skills);

  return {
    layoutType,
    content,
    textPreview: renderTextPreview(layoutJson),
    layoutJson: input.returnLayoutJson === false ? { ...layoutJson, blocks: [] } : layoutJson,
    renderResult: {
      svg: renderSvgPreview(layoutJson)
    },
    reason: explainLayoutChoice(analysis, layoutType)
  };
}
