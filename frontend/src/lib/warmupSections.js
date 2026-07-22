/** Warm Up module sub-chapters. */

import { WARM_UP_PLAYBOOK_EN, WARM_UP_PLAYBOOK_FR } from "./warmUpPlaybook";
import { WARM_UP_POSTS_EN, WARM_UP_POSTS_FR, warmUpPostsToBlocks } from "./warmUpPostsData";

export const WARM_UP_SECTIONS_EN = [
  {
    section_id: "sec_wu_sop",
    title: "TikTok / IG Warmup SOP",
    video_url: "",
    content: WARM_UP_PLAYBOOK_EN,
  },
  {
    section_id: "sec_wu_posts",
    title: "Warm Up Posts",
    video_url: "",
    content: warmUpPostsToBlocks(WARM_UP_POSTS_EN, "en"),
  },
];

export const WARM_UP_SECTIONS_FR = [
  {
    section_id: "sec_wu_sop",
    title: "SOP échauffement TikTok / IG",
    video_url: "",
    content: WARM_UP_PLAYBOOK_FR,
  },
  {
    section_id: "sec_wu_posts",
    title: "Warm Up Posts",
    video_url: "",
    content: warmUpPostsToBlocks(WARM_UP_POSTS_FR, "fr"),
  },
];
