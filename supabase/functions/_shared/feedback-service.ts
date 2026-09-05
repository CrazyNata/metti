import { AppError } from "./errors.ts";
import type { UserDataClient } from "./supabase-client.ts";
import type {
  AuthenticatedUser,
  OutfitFeedbackDto,
  OutfitFeedbackReason,
  OutfitFeedbackRow,
  OutfitFeedbackReaction,
  SaveOutfitFeedbackInput,
} from "./types.ts";
import { idValue, optionalString } from "./validation.ts";
import type { OutfitService } from "./outfit-service.ts";

export const OUTFIT_FEEDBACK_SELECT = [
  "id",
  "user_id",
  "outfit_id",
  "reaction",
  "reason",
  "comment",
  "created_at",
  "updated_at",
].join(",");

const FEEDBACK_REASONS = new Set<OutfitFeedbackReason>([
  "too_formal",
  "too_casual",
  "too_boring",
  "too_bright",
  "too_dark",
  "not_my_style",
  "bad_proportions",
  "wrong_shoes",
  "too_many_layers",
  "other",
]);

function reactionValue(value: unknown): OutfitFeedbackReaction {
  if (value === "like" || value === "dislike") return value;
  throw new AppError("invalid_input", "reaction must be like or dislike.");
}

function reasonValue(
  value: unknown,
  reaction: OutfitFeedbackReaction,
): OutfitFeedbackReason | null {
  const reason = optionalString(value, "reason", 40);
  if (reason === undefined || reason === null || reaction === "like") {
    return null;
  }
  if (!FEEDBACK_REASONS.has(reason as OutfitFeedbackReason)) {
    throw new AppError("invalid_input", "reason is invalid.");
  }
  return reason as OutfitFeedbackReason;
}

function feedbackFromRow(row: OutfitFeedbackRow): OutfitFeedbackDto {
  return {
    id: row.id,
    outfitId: row.outfit_id,
    reaction: row.reaction,
    reason: row.reason ?? null,
    comment: row.comment ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
  };
}

export class FeedbackService {
  constructor(
    private readonly client: UserDataClient,
    private readonly user: AuthenticatedUser,
    private readonly outfits: OutfitService,
  ) {}

  async list(limit = 100): Promise<OutfitFeedbackDto[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 100)));
    const query = new URLSearchParams({
      select: OUTFIT_FEEDBACK_SELECT,
      order: "created_at.desc",
      limit: String(safeLimit),
    });
    const rows = await this.client.listRows<OutfitFeedbackRow>(
      "outfit_feedback",
      query,
    );
    return rows.map(feedbackFromRow);
  }

  async save(input: SaveOutfitFeedbackInput): Promise<OutfitFeedbackDto> {
    const outfitId = idValue(input.outfitId, "outfitId");
    // Ownership is checked through the existing outfit service/RLS boundary.
    await this.outfits.getRow(outfitId);
    const reaction = reactionValue(input.reaction);
    const reason = reasonValue(input.reason, reaction);
    const comment = optionalString(input.comment, "comment", 1000) ?? null;
    const row = await this.client.upsertRow<OutfitFeedbackRow>(
      "outfit_feedback",
      new URLSearchParams({ on_conflict: "user_id,outfit_id" }),
      {
        user_id: this.user.id,
        outfit_id: outfitId,
        reaction,
        reason,
        comment,
      },
    );
    if (!row?.id) {
      throw new AppError(
        "data_access_error",
        "Не удалось сохранить реакцию на образ.",
        502,
      );
    }
    return feedbackFromRow(row);
  }
}
