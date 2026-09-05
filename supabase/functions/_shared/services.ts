import type { AuthenticatedUser } from "./types.ts";
import type { UserDataClient } from "./supabase-client.ts";
import { FeedbackService } from "./feedback-service.ts";
import { ImageService, type ImageServiceOptions } from "./image-service.ts";
import { OutfitService } from "./outfit-service.ts";
import { ProfileService } from "./profile-service.ts";
import {
  WardrobeService,
  type WardrobeServiceOptions,
} from "./wardrobe-service.ts";

export interface ApplicationServices {
  wardrobe: WardrobeService;
  images: ImageService;
  profile: ProfileService;
  outfits: OutfitService;
  feedback: FeedbackService;
}

export interface ApplicationServiceOptions {
  image?: ImageServiceOptions;
  wardrobe?: WardrobeServiceOptions;
}

export function createApplicationServices(
  client: UserDataClient,
  user: AuthenticatedUser,
  options: ApplicationServiceOptions = {},
): ApplicationServices {
  const images = new ImageService(client, user, options.image);
  const wardrobe = new WardrobeService(client, user, images, options.wardrobe);
  const outfits = new OutfitService(client, user, wardrobe);
  return {
    wardrobe,
    images,
    profile: new ProfileService(client, user),
    outfits,
    feedback: new FeedbackService(client, user, outfits),
  };
}
