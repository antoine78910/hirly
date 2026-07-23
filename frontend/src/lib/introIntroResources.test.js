import {
  INTRODUCE_HIRLY_RESOURCES_EN,
  INTRODUCE_HIRLY_RESOURCES_FR,
} from "./introIntroResources";
import { HIRLY_EXAMPLE_VIDEOS_FR } from "./hirlyExampleVideosFr";

describe("Introducing Hirly video examples", () => {
  test("keeps the English lesson structurally identical to the French video examples", () => {
    expect(INTRODUCE_HIRLY_RESOURCES_EN.slice(-HIRLY_EXAMPLE_VIDEOS_FR.length)).toEqual(
      HIRLY_EXAMPLE_VIDEOS_FR,
    );
    expect(INTRODUCE_HIRLY_RESOURCES_FR.slice(-HIRLY_EXAMPLE_VIDEOS_FR.length)).toEqual(
      HIRLY_EXAMPLE_VIDEOS_FR,
    );

    const accordion = HIRLY_EXAMPLE_VIDEOS_FR.at(-1);
    expect(accordion.items.map((item) => item.title)).toEqual([
      "Swipe",
      "Historique",
      "CV & lettre IA",
      "Formats de tournage",
    ]);
  });
});
