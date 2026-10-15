import { studioTheme } from "ag-studio";

/**
 * AG Studio in Exhibit's paperwork: the canvas is the blue backing sheet filings are stapled to, every
 * widget is a sheet of white bond with a hairline edge, and colour only where it means something
 * (respondent blue for the seller, claimant yellow for the buyer, due red for deadlines and stamps, won
 * green for outcomes). Values are the tokens in app/globals.css, so the dashboard reads as part of the site,
 * the same way components/desk/DeskGrid.tsx themes the desk grid.
 */

const ink = "#13203a";
const inkSoft = "#57627a";
const inkFaint = "#8792a8";
const rule = "#c2cddc";
const ruleSoft = "#dbe2ec";
const backing = "#dce4ef";
const sheet = "#fbfcfd";
const respondent = "#2b63e8";
const respondentWash = "#e6edfd";
const line = (color: string) => ({ width: 1, color });

const sans = "var(--font-sans), 'Public Sans', system-ui, sans-serif";

// Series colours in the order a chart hands them out. The report orders its series to match: at stake or kept
// sentences in the seller's blue, lost or struck in due red, won in green, refunded in plain ink.
const PALETTE = [respondent, "#d3242c", "#17845a", ink, "#f3cf3a", inkFaint, "#1d4bc4", "#c9a400", "#7fa0f0", "#a9b4c6"];
const palette = Object.fromEntries(
  PALETTE.flatMap((color, i) => [
    [`chartPaletteFills${i + 1}Color`, color],
    [`chartPaletteStrokes${i + 1}Color`, color],
  ]),
);

export const exhibitStudioTheme = studioTheme.withParams({
  // Shared by Studio's own UI, grid widgets and chart widgets.
  fontFamily: sans,
  fontSize: 14,
  textColor: ink,
  foregroundColor: ink,
  subtleTextColor: inkSoft,
  backgroundColor: sheet,
  borderColor: ruleSoft,
  borderRadius: 3,
  accentColor: respondent,
  iconColor: ink,
  rowHoverColor: "#f1f5fd",
  invalidColor: "#d3242c",
  browserColorScheme: "light",
  tooltipBackgroundColor: ink,
  tooltipTextColor: sheet,
  tooltipBorder: false,

  // The backing sheet, edge to edge: no frame of Studio's own.
  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: backing,
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: backing,
  studioCanvasGridLineColor: "rgba(43, 99, 232, 0.12)",
  studioCanvasPadding: 14,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: sans,

  // Each widget a sheet of paper: white bond, hairline rule, the sheet's 3px corner.
  studioWidgetBackgroundColor: sheet,
  studioWidgetBorder: line(rule),
  studioWidgetBorderRadius: 3,
  studioWidgetPadding: 10,
  studioWidgetTitleFontFamily: sans,
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 700,
  studioWidgetTitleTextColor: ink,
  studioWidgetSubtitleFontFamily: sans,
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: inkSoft,
  studioWidgetCaptionFontFamily: sans,
  studioWidgetCaptionFontSize: 12.5,
  studioWidgetCaptionTextColor: inkFaint,
  studioWidgetResizeBorderColor: respondent,
  studioWidgetToolbarBackgroundColor: sheet,
  studioWidgetToolbarBorder: line(rule),
  studioWidgetLoadingOverlayBackgroundColor: "rgba(251, 252, 253, 0.85)",
  studioWidgetNoDataOverlayBackgroundColor: sheet,
  studioValueWidgetFontSize: 30,

  // Panels are more paper: the edit, data and analyst panels sit on the backing like loose sheets.
  studioPanelContainerBackgroundColor: sheet,
  studioPanelContainerBorder: line(rule),
  studioPanelContainerBorderRadius: 3,
  studioPanelDividerColor: rule,
  studioPanelDividerActiveColor: respondent,
  studioPanelSectionBorderColor: ruleSoft,
  studioPanelHeaderFontFamily: sans,
  studioPanelHeaderFontWeight: 700,
  studioPanelChevronButtonHoverBackgroundColor: respondentWash,
  studioPanelChevronButtonHoverColor: respondent,
  studioAiPanelWidth: 340,
  studioAiPanelButtonHoverBackgroundColor: respondentWash,
  studioAiPanelInputMessageBackgroundColor: respondentWash,
  studioToggleButtonActiveBackgroundColor: respondentWash,
  studioToggleButtonActiveBorderColor: respondent,
  studioToggleButtonActiveColor: respondent,
  studioFormLabelColor: inkSoft,

  // Buttons and inputs follow the site's: quiet outline, blue when it matters.
  buttonBorderRadius: 6,
  inputBorderRadius: 4,
  inputBorder: line(rule),
  inputFocusBorder: line(respondent),

  // Grid widgets match the desk grid.
  gridFontFamily: sans,
  gridFontSize: 13.5,
  gridCellTextColor: ink,
  gridHeaderBackgroundColor: "#f1f4f9",
  gridHeaderTextColor: inkSoft,
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 12.5,
  gridRowHeight: 38,
  gridHeaderHeight: 36,
  gridRowBorder: line("#e6ebf2"),
  gridHeaderRowBorder: line(ruleSoft),
  gridPinnedRowBorder: line(ruleSoft),
  gridRowHoverColor: "#f1f5fd",
  gridWrapperBorder: false,
  gridWrapperBorderRadius: 2,

  // Charts: plain sans labels, faint rules, the semantic palette.
  chartFontFamily: sans,
  chartTextColor: ink,
  chartSubtleTextColor: inkSoft,
  chartAxisLineColor: rule,
  chartGridLineColor: "#e6ebf2",
  chartTooltipBackgroundColor: ink,
  chartTooltipTextColor: sheet,
  chartTooltipBorderRadius: 3,
  ...palette,
});
