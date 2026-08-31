import { AppError } from "./errors.ts";
import {
  asJsonObject,
  profileFromRow,
  stylePreferencesFromProfile,
} from "./serializers.ts";
import type { UserDataClient } from "./supabase-client.ts";
import type {
  AuthenticatedUser,
  JsonObject,
  ProfileDto,
  ProfilePreferencesInput,
  ProfileRow,
  StylePreferencesDto,
} from "./types.ts";
import { asRecord, profilePreferenceInput } from "./validation.ts";

export const PROFILE_SELECT = [
  "id",
  "display_name",
  "city",
  "preferences",
  "style_tags",
  "style_profile",
  "created_at",
  "updated_at",
].join(",");

function firstMetadataString(user: AuthenticatedUser): string {
  const metadata = asRecord(user.user_metadata);
  const name = typeof metadata.full_name === "string"
    ? metadata.full_name
    : typeof metadata.name === "string"
    ? metadata.name
    : "";
  return name.trim() || user.email?.split("@")[0] || "Пользователь";
}

export class ProfileService {
  constructor(
    private readonly client: UserDataClient,
    private readonly user: AuthenticatedUser,
  ) {}

  async getRow(): Promise<ProfileRow | null> {
    const query = new URLSearchParams({
      select: PROFILE_SELECT,
      id: `eq.${this.user.id}`,
      limit: "1",
    });
    const rows = await this.client.listRows<ProfileRow>("profiles", query);
    return rows[0] ?? null;
  }

  async get(): Promise<ProfileDto> {
    return profileFromRow(await this.getRow(), this.user);
  }

  async getPreferences(): Promise<StylePreferencesDto> {
    return stylePreferencesFromProfile(await this.getRow(), this.user);
  }

  async updatePreferences(
    input: ProfilePreferencesInput,
  ): Promise<StylePreferencesDto> {
    const normalized = profilePreferenceInput(input);
    const current = await this.getRow();
    const currentPreferences = asJsonObject(current?.preferences) as Record<
      string,
      unknown
    >;
    const currentStyleProfile = asJsonObject(current?.style_profile) as Record<
      string,
      unknown
    >;

    const preferences = { ...currentPreferences };
    const styleProfile = { ...currentStyleProfile };
    if (normalized.preferredColors !== undefined) {
      preferences.preferred_colors = normalized.preferredColors;
      // Keep the key used by the existing mobile profile form in sync.
      preferences.favorite_colors = normalized.preferredColors;
    }
    if (normalized.avoidedColors !== undefined) {
      preferences.avoided_colors = normalized.avoidedColors;
    }
    if (normalized.preferredBrands !== undefined) {
      preferences.preferred_brands = normalized.preferredBrands;
    }
    if (normalized.dislikedBrands !== undefined) {
      preferences.disliked_brands = normalized.dislikedBrands;
    }
    if (normalized.preferredFits !== undefined) {
      preferences.preferred_fits = normalized.preferredFits;
      // Keep the legacy key used by the existing profile form in sync.
      styleProfile.fit = normalized.preferredFits[0] ?? null;
    }
    if (normalized.styleNotes !== undefined) {
      preferences.style_notes = normalized.styleNotes;
      preferences.note = normalized.styleNotes;
    }
    if (normalized.clothingSizes !== undefined) {
      styleProfile.clothing_sizes = normalized.clothingSizes;
      styleProfile.sizes = normalized.clothingSizes;
      const sizeValues = Object.values(normalized.clothingSizes);
      styleProfile.size = sizeValues.length === 1 ? sizeValues[0] : null;
    }
    if (normalized.shoeSize !== undefined) {
      styleProfile.shoe_size = normalized.shoeSize;
    }
    if (normalized.height !== undefined) {
      styleProfile.height = normalized.height;
    }
    if (normalized.gender !== undefined) {
      styleProfile.gender = normalized.gender;
    }

    const styleTags = normalized.styleTags ?? current?.style_tags ?? [];
    const payload = {
      id: this.user.id,
      display_name: current?.display_name ?? firstMetadataString(this.user),
      city: current?.city ?? "Prague",
      preferences: preferences as JsonObject,
      style_tags: styleTags,
      style_profile: styleProfile as JsonObject,
    };
    const query = new URLSearchParams({ on_conflict: "id" });
    const row = await this.client.upsertRow<ProfileRow>(
      "profiles",
      query,
      payload,
    );
    if (!row?.id) {
      throw new AppError(
        "data_access_error",
        "Не удалось сохранить предпочтения.",
        502,
      );
    }
    return stylePreferencesFromProfile(row, this.user);
  }
}
