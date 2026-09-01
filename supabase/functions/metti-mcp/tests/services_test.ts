import { AppError } from "../../_shared/errors.ts";
import { createApplicationServices } from "../../_shared/services.ts";
import type {
  AuthenticatedUser,
  WardrobeImageInput,
} from "../../_shared/types.ts";
import { assert, assertEquals, assertRejects } from "./assert.ts";
import { MemoryDataClient, outfitRow, wardrobeRow } from "./fake-client.ts";

const userA: AuthenticatedUser = { id: "user-a", email: "a@example.com" };
const userB: AuthenticatedUser = { id: "user-b", email: "b@example.com" };

function appError(code: string) {
  return (error: unknown) => error instanceof AppError && error.code === code;
}

Deno.test("wardrobe service lists, searches, paginates and isolates items", async () => {
  const db = new MemoryDataClient(userA.id);
  db.seedWardrobe(
    wardrobeRow("a-top-1", userA.id, {
      name: "Silk blouse",
      category: "top",
      color: "ivory",
      brand: "Metti",
      metadata: {
        occasions: ["dinner", "work"],
        tags: ["silk", "favorite"],
        favorite: true,
      },
      created_at: "2026-01-03T00:00:00.000Z",
      image_path: `${userA.id}/a-top-1.webp`,
    }),
    wardrobeRow("a-top-2", userA.id, {
      name: "Cotton shirt",
      category: "top",
      color: "blue",
      metadata: { occasions: ["work"], tags: ["cotton"] },
      created_at: "2026-01-02T00:00:00.000Z",
    }),
    wardrobeRow("a-bottom-1", userA.id, {
      name: "Straight jeans",
      category: "bottom",
      color: "blue",
      metadata: {
        subcategory: "jeans",
        occasions: ["casual"],
        tags: ["casual"],
      },
      created_at: "2026-01-01T00:00:00.000Z",
    }),
    wardrobeRow("b-top-1", userB.id, {
      name: "Private blouse",
      category: "top",
    }),
  );

  const services = createApplicationServices(db, userA);
  const page = await services.wardrobe.list({ category: "top", limit: 1 });
  assertEquals(page.items.map((item) => item.id), ["a-top-1"]);
  assertEquals(page.pagination, {
    page: 1,
    limit: 1,
    hasMore: true,
    nextPage: 2,
  });
  assert(page.items[0].imageUrl?.includes("a-top-1.webp"));

  const search = await services.wardrobe.search({
    query: "jeans",
    subcategory: "jeans",
    occasions: ["casual"],
    colors: ["blue"],
    limit: 10,
  });
  assertEquals(search.items.map((item) => item.id), ["a-bottom-1"]);

  await assertRejects(
    () => services.wardrobe.get("b-top-1"),
    appError("not_found"),
    "A user must not read another user wardrobe item.",
  );
  await assertRejects(
    () => services.wardrobe.update("b-top-1", { color: "red" }),
    appError("not_found"),
    "A user must not update another user wardrobe item.",
  );
});

Deno.test("wardrobe service adds, partially updates and archives an item", async () => {
  const db = new MemoryDataClient(userA.id);
  const services = createApplicationServices(db, userA);

  const added = await services.wardrobe.add({
    name: "Black loafers",
    category: "shoes",
    colors: ["black", "black"],
    occasions: ["work", "dinner"],
    tags: ["classic"],
    imagePath: `${userA.id}/loafers.webp`,
  });
  assertEquals(added.category, "shoes");
  assertEquals(added.colors, ["black"]);
  assertEquals(added.occasions, ["work", "dinner"]);

  const updated = await services.wardrobe.update(added.id, {
    color: "espresso",
    favorite: true,
    seasons: ["осень"],
    styles: ["Smart Casual"],
    length: "Midi",
  });
  assertEquals(updated.color, "espresso");
  assertEquals(updated.favorite, true);
  assertEquals(updated.seasons, ["autumn"]);
  assertEquals(updated.styles, ["smart-casual"]);
  assertEquals(updated.length, "midi");

  const archived = await services.wardrobe.archive(added.id);
  assertEquals(archived.status, "archived");
  assertEquals((await services.wardrobe.list()).items, []);
  assertEquals(
    (await services.wardrobe.list({ status: "archived" })).items.map((item) =>
      item.id
    ),
    [added.id],
  );
  assertEquals((await services.wardrobe.archive(added.id)).status, "archived");
});

Deno.test("wardrobe image operations use one private storage path and compensate failures", async () => {
  const db = new MemoryDataClient(userA.id);
  const services = createApplicationServices(db, userA);
  const inlineImage: WardrobeImageInput = {
    type: "image",
    data: "/9j/2Q==",
    mimeType: "image/jpeg",
  };

  const created = await services.wardrobe.add({
    name: "Image blouse",
    category: "top",
    colors: ["black"],
    image: inlineImage,
  });
  assertEquals(created.imageAttached, true);
  assertEquals(created.imageStatus, "attached");
  const originalPath = db.wardrobe(created.id)?.image_path;
  assert(originalPath?.startsWith(`${userA.id}/`));
  assertEquals(db.uploadedImages.size, 1);
  assertEquals(
    (await services.wardrobe.search({ colors: ["ЧЁРНЫЙ"] })).items.map((item) =>
      item.id
    ),
    [created.id],
  );
  await services.wardrobe.removeImage(created.id);
  assertEquals(db.uploadedImages.size, 0);

  const withoutImage = await services.wardrobe.add({
    name: "Image-free blouse",
    category: "top",
  });
  assertEquals(withoutImage.imageAttached, false);
  assertEquals(withoutImage.imageStatus, "none");
  const attached = await services.wardrobe.attachImage(withoutImage.id, {
    type: "resource",
    resource: {
      uri: "mcp://attachment/image-1",
      mimeType: "image/jpeg",
      blob: "/9j/2Q==",
    },
  });
  assertEquals(attached.imageAttached, true);
  const attachedPath = db.wardrobe(withoutImage.id)?.image_path;
  assert(attachedPath?.startsWith(`${userA.id}/`));

  const replaced = await services.wardrobe.replaceImage(
    withoutImage.id,
    inlineImage,
  );
  assertEquals(replaced.imageAttached, true);
  assertEquals(db.uploadedImages.get(`wardrobe/${attachedPath}`)?.upsert, true);

  const removed = await services.wardrobe.removeImage(withoutImage.id);
  assertEquals(removed.imageStatus, "none");
  assertEquals(db.wardrobe(withoutImage.id)?.image_path, null);
  assert(db.removedImagePaths.includes(attachedPath!));

  db.seedWardrobe(wardrobeRow("b-image", userB.id, { category: "top" }));
  await assertRejects(
    () => services.wardrobe.attachImage("b-image", inlineImage),
    appError("not_found"),
    "A user must not attach an image to another user item.",
  );

  const invalidMime = {
    type: "image",
    data: "/9j/2Q==",
    mimeType: "image/gif",
  } as unknown as WardrobeImageInput;
  await assertRejects(
    () =>
      services.wardrobe.add({
        name: "Invalid",
        category: "top",
        image: invalidMime,
      }),
    appError("invalid_input"),
    "Unsupported image MIME types must be rejected.",
  );

  const smallServices = createApplicationServices(db, userA, {
    image: { maxBytes: 3 },
  });
  await assertRejects(
    () =>
      smallServices.wardrobe.add({
        name: "Large",
        category: "top",
        image: inlineImage,
      }),
    appError("invalid_input"),
    "Oversized images must be rejected.",
  );

  db.failImageLinkUpdate = true;
  const compensated = await services.wardrobe.add({
    name: "Compensated image",
    category: "top",
    image: inlineImage,
  });
  assertEquals(compensated.imageAttached, false);
  assertEquals(compensated.imageStatus, "pending");
  assertEquals(db.wardrobe(compensated.id)?.image_path, null);
  assertEquals(db.uploadedImages.size, 0);

  db.failImageUpload = true;
  const failedUpload = await services.wardrobe.add({
    name: "Failed upload",
    category: "top",
    image: inlineImage,
  });
  assertEquals(failedUpload.imageAttached, false);
  assertEquals(failedUpload.imageStatus, "pending");
  assertEquals(db.wardrobe(failedUpload.id)?.image_path, null);
  db.failImageUpload = false;
});

Deno.test("MCP image uploads are marked for the app editorial background pass", async () => {
  const db = new MemoryDataClient(userA.id);
  const services = createApplicationServices(db, userA, {
    wardrobe: { imageOrigin: "mcp" },
  });
  const item = await services.wardrobe.add({
    name: "MCP blouse",
    category: "top",
    image: { type: "image", data: "/9j/2Q==", mimeType: "image/jpeg" },
  });
  const metadata = db.wardrobe(item.id)?.metadata as Record<string, unknown>;
  assertEquals(metadata.image_source, "mcp");
  assertEquals(metadata.image_background, "pending");

  await services.wardrobe.removeImage(item.id);
  const removedMetadata = db.wardrobe(item.id)?.metadata as Record<string, unknown>;
  assertEquals(removedMetadata.image_source, undefined);
  assertEquals(removedMetadata.image_background, undefined);
});

Deno.test("remote image resources require an allowlisted HTTPS host", async () => {
  const db = new MemoryDataClient(userA.id);
  let fetchCalls = 0;
  const remoteFetch = async (input: RequestInfo | URL): Promise<Response> => {
    fetchCalls += 1;
    const url = new URL(input.toString());
    if (url.hostname !== "images.example") {
      return new Response("blocked", { status: 404 });
    }
    return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
      headers: { "content-type": "image/jpeg" },
    });
  };
  const services = createApplicationServices(db, userA, {
    image: { allowedHosts: ["images.example"], fetchImpl: remoteFetch },
  });

  const pending = await services.wardrobe.add({
    name: "Unconfigured remote",
    category: "top",
    image: {
      type: "resource_link",
      uri: "https://not-allowlisted.example/image.jpg",
      mimeType: "image/jpeg",
    },
  });
  assertEquals(pending.imageStatus, "pending");
  assertEquals(fetchCalls, 0);

  const attached = await services.wardrobe.add({
    name: "Allowlisted remote",
    category: "top",
    image: {
      type: "resource_link",
      uri: "https://images.example/image.jpg",
    },
  });
  assertEquals(attached.imageStatus, "attached");
  assertEquals(fetchCalls, 1);
});

Deno.test("profile and outfit services share ownership, metadata and wear history", async () => {
  const db = new MemoryDataClient(userA.id);
  db.seedProfile({
    id: userA.id,
    display_name: "Anna",
    city: "Prague",
    preferences: { favorite_colors: ["cream"] },
    style_tags: ["minimal"],
    style_profile: { size: "M" },
  });
  db.seedWardrobe(
    wardrobeRow("a-jacket", userA.id, { name: "Jacket", category: "outer" }),
    wardrobeRow("a-jeans", userA.id, { name: "Jeans", category: "bottom" }),
    wardrobeRow("b-shoes", userB.id, {
      name: "Private shoes",
      category: "shoes",
    }),
  );
  db.seedOutfits(
    outfitRow("b-outfit", userB.id, {
      title: "Private outfit",
      item_ids: ["b-shoes"],
    }),
  );

  const services = createApplicationServices(db, userA);
  const preferences = await services.profile.updatePreferences({
    preferredColors: ["black", "cream"],
    preferredFits: ["regular"],
    clothingSizes: { tops: "M" },
    styleNotes: "Prefer simple layers",
  });
  assertEquals(preferences.preferredColors, ["black", "cream"]);
  assertEquals(preferences.clothingSizes, { tops: "M" });
  assertEquals(preferences.styleNotes, "Prefer simple layers");
  assertEquals((await services.profile.get()).displayName, "Anna");

  const saved = await services.outfits.save({
    name: "Dinner layers",
    itemIds: ["a-jacket", "a-jeans"],
    occasion: "dinner",
    season: "autumn",
    tags: ["smart-casual"],
  });
  assertEquals(saved.items?.map((item) => item.id), ["a-jacket", "a-jeans"]);
  assertEquals(saved.occasion, "dinner");

  await assertRejects(
    () => services.outfits.save({ itemIds: ["a-jacket", "b-shoes"] }),
    appError("not_found"),
    "An outfit must not reference another user wardrobe item.",
  );
  await assertRejects(
    () => services.outfits.get("b-outfit"),
    appError("not_found"),
    "A user must not read another user outfit.",
  );
  await assertRejects(
    () => services.outfits.update("b-outfit", { name: "Should not update" }),
    appError("not_found"),
    "A user must not update another user outfit.",
  );

  const updated = await services.outfits.update(saved.id, {
    name: "Dinner layers updated",
  });
  assertEquals(updated.name, "Dinner layers updated");
  const favorited = await services.outfits.favorite(saved.id, true);
  assertEquals(favorited.favorite, true);
  assertEquals(
    (await services.outfits.list({ favorites: true })).items.map((item) =>
      item.id
    ),
    [saved.id],
  );

  const worn = await services.outfits.markAsWorn({
    outfitId: saved.id,
    wornAt: "2026-01-05T19:00:00.000Z",
  });
  assertEquals(worn.isWorn, true);
  assertEquals(
    (await services.outfits.getWearHistory()).entries.map((entry) =>
      entry.outfitId
    ),
    [saved.id],
  );

  const archived = await services.outfits.archive(saved.id);
  assertEquals(archived.status, "archived");
  assertEquals((await services.outfits.list()).items, []);
  assertEquals(
    (await services.outfits.list({ status: "archived" })).items.map((item) =>
      item.id
    ),
    [saved.id],
  );
});
