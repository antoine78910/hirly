import {
  INTRODUCE_HIRLY_RESOURCES_EN,
  INTRODUCE_HIRLY_RESOURCES_FR,
} from "./introIntroResources";
import {
  HIRLY_EXAMPLE_VIDEOS_EN,
  HIRLY_EXAMPLE_VIDEOS_FR,
} from "./hirlyExampleVideosFr";

describe("Introducing Hirly video examples", () => {
  test("localizes English copy without changing the available video slots", () => {
    expect(INTRODUCE_HIRLY_RESOURCES_EN.slice(-HIRLY_EXAMPLE_VIDEOS_EN.length)).toEqual(
      HIRLY_EXAMPLE_VIDEOS_EN,
    );
    expect(INTRODUCE_HIRLY_RESOURCES_FR.slice(-HIRLY_EXAMPLE_VIDEOS_FR.length)).toEqual(
      HIRLY_EXAMPLE_VIDEOS_FR,
    );
    expect(HIRLY_EXAMPLE_VIDEOS_EN).not.toEqual(HIRLY_EXAMPLE_VIDEOS_FR);
    expect(HIRLY_EXAMPLE_VIDEOS_EN[0].text).toBe("Video examples");

    const englishAccordion = HIRLY_EXAMPLE_VIDEOS_EN.at(-1);
    const frenchAccordion = HIRLY_EXAMPLE_VIDEOS_FR.at(-1);
    expect(englishAccordion.items.map((item) => item.title)).toEqual([
      "Swipe",
      "Application history",
      "Resume & AI cover letter",
      "Filming formats",
    ]);

    const slots = (accordion) =>
      accordion.items.flatMap((item) =>
        item.content
          .filter((block) => block.type === "short_video")
          .map((block) => block.upload_slot),
      );
    expect(slots(englishAccordion)).toEqual(slots(frenchAccordion));
  });
});
