export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | {
  [key: string]: JsonValue;
};
export type JsonObject = { [key: string]: JsonValue };

export const WARDROBE_CATEGORIES = [
  "outer",
  "top",
  "bottom",
  "shoes",
  "accessory",
] as const;
export type WardrobeCategory = (typeof WARDROBE_CATEGORIES)[number];
export type WardrobeStatus = "active" | "archived";
export type WardrobeImageStatus =
  | "attached"
  | "pending"
  | "processing"
  | "needs_review"
  | "failed"
  | "none";

/**
 * Image content shapes defined by MCP's content/resource vocabulary. The
 * server accepts these shapes as tool arguments when a host can forward the
 * original attachment. It never persists the encoded data itself.
 */
export interface McpImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface McpResourceLink {
  type: "resource_link";
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpEmbeddedResource {
  type: "resource";
  resource: {
    uri: string;
    mimeType?: string;
    blob?: string;
    text?: string;
  };
}

export type WardrobeImageInput =
  | McpImageContent
  | McpResourceLink
  | McpEmbeddedResource;

/**
 * File object passed by ChatGPT for a top-level MCP file parameter. The
 * download URL is temporary and is fetched only by the server; the file id is
 * retained in the contract so the host can identify the original attachment.
 */
export interface OpenAiFileInput {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
  user_metadata?: JsonObject;
}

export interface AuthContext {
  accessToken: string;
  authorization: string;
  user: AuthenticatedUser;
}

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

export interface ProfileRow {
  id: string;
  display_name: string | null;
  city: string;
  preferences: JsonObject | null;
  style_tags: string[] | null;
  style_profile: JsonObject | null;
  created_at?: string;
  updated_at?: string;
}

export interface WardrobeItemRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  category: WardrobeCategory;
  color: string | null;
  size: string | null;
  season: string | null;
  brand: string | null;
  notes: string | null;
  image_path: string | null;
  original_image_path?: string | null;
  processed_image_path?: string | null;
  image_status?: WardrobeImageStatus | null;
  image_error?: string | null;
  metadata: JsonObject | null;
  created_at: string;
  updated_at?: string;
  archived_at?: string | null;
}

export interface SavedOutfitRow {
  id: string;
  user_id: string;
  title: string;
  note: string | null;
  prompt: string | null;
  temperature_c: number | null;
  weather_code: number | null;
  item_ids: string[];
  is_worn: boolean;
  worn_at: string | null;
  metadata: JsonObject | null;
  created_at: string;
  updated_at?: string;
  archived_at?: string | null;
}

export interface WardrobeItemDto {
  id: string;
  name: string;
  description: string | null;
  category: WardrobeCategory;
  subcategory: string | null;
  brand: string | null;
  color: string | null;
  colors: string[];
  size: string | null;
  season: string | null;
  seasons: string[];
  material: string | null;
  pattern: string | null;
  fit: string | null;
  length: string | null;
  styles: string[];
  occasions: string[];
  tags: string[];
  notes: string | null;
  favorite: boolean;
  status: WardrobeStatus;
  imageUrl: string | null;
  originalImageUrl: string | null;
  processedImageUrl: string | null;
  imageStatus: WardrobeImageStatus;
  createdAt: string;
}

export interface WardrobeItemActionDto extends WardrobeItemDto {
  imageAttached: boolean;
  imageStatus: WardrobeImageStatus;
}

export interface ProfileDto {
  id: string;
  displayName: string;
  email: string | null;
  city: string;
  gender: string | null;
  clothingSizes: Record<string, string>;
  shoeSize: string | null;
  height: number | null;
  preferredFits: string[];
  preferredColors: string[];
  avoidedColors: string[];
  preferredBrands: string[];
  dislikedBrands: string[];
  styleTags: string[];
  styleNotes: string | null;
}

export interface StylePreferencesDto {
  styleTags: string[];
  preferredColors: string[];
  avoidedColors: string[];
  preferredBrands: string[];
  dislikedBrands: string[];
  preferredFits: string[];
  clothingSizes: Record<string, string>;
  shoeSize: string | null;
  height: number | null;
  gender: string | null;
  styleNotes: string | null;
}

export interface OutfitDto {
  id: string;
  name: string;
  notes: string | null;
  prompt: string | null;
  itemIds: string[];
  items?: WardrobeItemDto[];
  occasion: string | null;
  season: string | null;
  tags: string[];
  favorite: boolean;
  status: WardrobeStatus;
  isWorn: boolean;
  wornAt: string | null;
  temperatureC: number | null;
  weatherCode: number | null;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface Pagination {
  page: number;
  limit: number;
  hasMore: boolean;
  nextPage: number | null;
}

export interface Page<T> {
  items: T[];
  pagination: Pagination;
}

export interface WardrobeListOptions {
  category?: WardrobeCategory;
  subcategory?: string;
  color?: string;
  colors?: string[];
  brand?: string;
  brands?: string[];
  season?: string;
  seasons?: string[];
  style?: string;
  styles?: string[];
  length?: string;
  occasion?: string;
  occasions?: string[];
  favorite?: boolean;
  status?: WardrobeStatus | "all";
  tags?: string[];
  page?: number;
  limit?: number;
  query?: string;
}

export interface WardrobeItemInput {
  name: string;
  description?: string | null;
  category: WardrobeCategory;
  subcategory?: string;
  brand?: string | null;
  color?: string | null;
  colors?: string[];
  size?: string | null;
  season?: string | null;
  seasons?: string[];
  material?: string | null;
  pattern?: string | null;
  fit?: string | null;
  length?: string | null;
  styles?: string[];
  occasion?: string | null;
  occasions?: string[];
  tags?: string[];
  notes?: string | null;
  favorite?: boolean;
  imagePath?: string | null;
  image?: WardrobeImageInput;
  imageFile?: OpenAiFileInput;
}

export type WardrobeItemUpdate = Partial<WardrobeItemInput>;

export interface ProfilePreferencesInput {
  styleTags?: string[];
  preferredColors?: string[];
  avoidedColors?: string[];
  preferredBrands?: string[];
  dislikedBrands?: string[];
  preferredFits?: string[];
  clothingSizes?: Record<string, string>;
  shoeSize?: string | null;
  height?: number | null;
  gender?: string | null;
  styleNotes?: string | null;
}

export interface OutfitListOptions {
  favorites?: boolean;
  occasion?: string;
  season?: string;
  date?: string;
  tags?: string[];
  status?: WardrobeStatus | "all";
  page?: number;
  limit?: number;
}

export interface SaveOutfitInput {
  name?: string;
  itemIds: string[];
  occasion?: string | null;
  season?: string | null;
  notes?: string | null;
  tags?: string[];
  favorite?: boolean;
  prompt?: string | null;
  temperatureC?: number | null;
  weatherCode?: number | null;
}

export interface OutfitUpdateInput {
  name?: string;
  itemIds?: string[];
  occasion?: string | null;
  season?: string | null;
  notes?: string | null;
  tags?: string[];
  favorite?: boolean;
  prompt?: string | null;
}
