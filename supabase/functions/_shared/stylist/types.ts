import type { WardrobeItemDto } from "../types.ts";

export type StylistMode =
  | "today"
  | "selected_item"
  | "restyle"
  | "packing"
  | "shopping_recommendation";

export type OutfitCreativity = "safe" | "balanced" | "bold";

export interface MissingPiece {
  category: string;
  preferredColors: string[];
  priority: number;
  reason: string;
}

export interface StylistContext {
  location?: string | null;
  temperature?: number | null;
  feelsLike?: number | null;
  weather?: string | null;
  precipitation?: number | string | null;
  wind?: number | string | null;
  occasion?: string | null;
  season?: string | null;
  durationDays?: number | null;
  activities?: string[];
  laundryAvailable?: boolean | null;
  [key: string]: unknown;
}

export interface StylistItem {
  itemId: string;
  category: string;
  subcategory: string | null;
  colors: string[];
  secondaryColors: string[];
  material: string | null;
  pattern: string | null;
  season: string[];
  styles: string[];
  occasions: string[];
  formality: number | null;
  fit: string | null;
  silhouette: string | null;
  length: string | null;
  warmth: number | null;
  waterproof: boolean | null;
  statementLevel: number | null;
  imageUrl: string | null;
  brand: string | null;
  notes: string | null;
  wearCount: number;
  lastWornAt: string | null;
  /** Small implicit signal; explicit profile settings always carry more weight. */
  feedbackScore: number;
  userFavorite: boolean;
}

export interface StyleProfileContext {
  preferredStyles: string[];
  dislikedStyles: string[];
  favoriteColors: string[];
  dislikedColors: string[];
  preferredFits: string[];
  dislikedFits: string[];
  preferredFormality: string[];
  favoriteItems: string[];
  avoidRules: string[];
  learnedPreferences: string[];
  confidence: number | null;
  explicit: Record<string, unknown>;
}

export interface GenerateOutfitsInput {
  mode: StylistMode;
  prompt: string;
  count: number;
  selectedItemId?: string;
  currentItemIds: string[];
  lockedItemIds: string[];
  instruction?: string;
  preferredCreativity?: OutfitCreativity;
  context: StylistContext;
  styleProfile: StyleProfileContext;
  availableItems: StylistItem[];
}

export interface StylistRepairInput {
  generation: GenerateOutfitsInput;
  validationErrors: string[];
  previousResponse: unknown;
}

export interface CritiqueInput {
  context: StylistContext;
  styleProfile: StyleProfileContext;
  outfits: OutfitSuggestion[];
  availableItems: StylistItem[];
}

export interface StyleProfileLearningInput {
  styleProfile: StyleProfileContext;
  feedback: unknown[];
  savedOutfits: unknown[];
  wearHistory: unknown[];
}

export interface LearnedPreference {
  preference: string;
  confidence: number;
}

export interface StyleProfileLearningChanges {
  add: LearnedPreference[];
  remove: LearnedPreference[];
  update: LearnedPreference[];
}

export interface OutfitSuggestion {
  name: string;
  itemIds: string[];
  creativity: OutfitCreativity;
  style: string[];
  occasion: string[];
  score: number;
  explanation: string;
  warnings: string[];
}

export interface CriticResult {
  outfitIndex: number;
  criticScore: number;
  issues: string[];
}

export interface StylistGenerationResult {
  outfits: OutfitSuggestion[];
  capsuleItemIds: string[];
  missingPieces: MissingPiece[];
  reason?: string;
  source: "ai" | "local-fallback";
  provider?: string;
  promptVersion: string;
  availableCount: number;
  filteredCount: number;
  validationErrors?: string[];
  latencyMs?: number;
}

export interface StylistLLM {
  readonly provider: string;
  generateOutfits(input: GenerateOutfitsInput): Promise<unknown>;
  repairOutfits?(input: StylistRepairInput): Promise<unknown>;
  critiqueOutfits(input: CritiqueInput): Promise<unknown>;
  analyzePurchase?(input: import("./purchase-advisor.ts").PurchaseAnalysisInput): Promise<unknown>;
  enrichItem?(item: WardrobeItemDto): Promise<unknown>;
  updateStyleProfile?(input: StyleProfileLearningInput): Promise<unknown>;
}
