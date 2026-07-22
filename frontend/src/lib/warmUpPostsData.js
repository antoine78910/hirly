/** Warm Up Posts — reference videos + trending audio links. */

import { examplesGrid, heading, infoScript, paragraph } from "./trainingDocBlocks";
import { blockLabels } from "./trainingBlockLabels";
import { WARM_UP_POSTS_FR } from "./warmUpPostsDataFr";

export { WARM_UP_POSTS_FR };

export const WARM_UP_POSTS_EN = [
  {
    title: "Never Going Into a Job Interview Scared Again",
    exampleLabel: "Britney's 100K Video",
    exampleUrl:
      "https://www.instagram.com/reel/DYufvBuSzfQ/?utm_source=ig_web_copy_link&igsh=NTc4MTIwNjQ2YQ==",
    audioUrl: "https://www.instagram.com/reels/audio/27387820134155033/",
    guidelines: ["Smile and slow video to 0.5–1× speed"],
    script:
      "Never going into a job interview scared again because it's basically a free open mic session where I talk about how awesome and spectacular I am",
    caption:
      "Can someone hire me pls? i've been searching everywhere on Linkedin, Indeed, Hirly, Glassdoor…\n#jobapplication #jobsearch #recruitment #jobmarket #interview",
  },
  {
    title: "I Know It's Really Cooked For Me",
    exampleLabel: "Britney's 303K Video",
    exampleUrl: "https://www.tiktok.com/@careernevie/video/7561229775436533023",
    audioUrl: "https://www.tiktok.com/music/hahah-do-it-jiggle-7353426944404310814",
    guidelines: ["Shaky finger pointing at camera, look shocked"],
    script:
      "My friend who graduated summa cum laude, had two big tech internships, and president of their consulting club telling me they haven't found a job so now I know it's REALLY cooked for me",
    caption:
      "Going to a school with cracked ppl really put a toll on my mental…\n#recruitment #jobapplication #collegelife #jobsearch #aihirlyai",
  },
  {
    title: "Until You Secure THAT BAG",
    exampleLabel: "Britney's 610K Video",
    exampleUrl: "https://www.tiktok.com/@careernevie/video/7560134062329826590",
    audioUrl: "https://www.tiktok.com/music/original-sound-7539597572680256270",
    guidelines: ['Type on laptop and open mouth at the "AHHH" sound'],
    script:
      "When you finally get an email saying you made it to the next round of interviews but you don't want to celebrate just yet until you secure THAT BAG",
    caption: "I hate doing interviews omfgg\n#recruitment #jobapplication #jobmarket #aihirlyai",
  },
  {
    title: "Job Market So Bad…",
    exampleLabel: "Sofia's 303K Video",
    exampleUrl: "https://www.tiktok.com/@careerwithsofia/video/7594694796975934751",
    audioUrl: "https://www.tiktok.com/music/NOT-CUTE-ANYMORE-Sped-up-7574691807540398081",
    guidelines: ["Smile, blink a lot, thumbs up"],
    script: "Job market so bad I'm interviewing to be hostess with an ivy league degree",
    caption:
      "How much does it take to get a job now 😭😭\n#jobmarket #jobapplication #aihirlyai #jobinterview #unemployed",
  },
  {
    title: "I'm Done Applying to Jobs",
    exampleLabel: "Britney's 590K Video",
    exampleUrl: "https://www.tiktok.com/@careernevie/video/7563375824846507294",
    audioUrl: "https://www.tiktok.com/music/for-the-first-time-7379062173470853934",
    guidelines: ["Look sad while typing on your laptop"],
    script: "I'm done applying to jobs because clearly everyone hates me and wants me to die",
    caption:
      "I've used Linkedin, Indeed, and Glassdoor for my job search and NO ONE REPLIES TO ME 😭\nBut I have heard that niche job apps are the way to go (from my bestie lol), so far I've tried Hirly, Discord, and those Instagram influencer groupchat things 😂😂\n#recruitment #jobsearch #jobapplication #jobboard #aihirlyai",
  },
  {
    title: "Tell Me the Craziest Job Hunting Hack",
    exampleLabel: "Britney's 546K Video",
    exampleUrl: "https://www.tiktok.com/@careernevie/video/7572317888477007134",
    audioUrl:
      "https://www.tiktok.com/music/%D0%BE%D1%80%D0%B8%D0%B3%D0%B8%D0%BD%D0%B0%D0%BB%D1%8C%D0%BD%D1%8B%D0%B9-%D0%B7%D0%B2%D1%83%D0%BA-7608493445921524498",
    guidelines: ["Cross hands/arms and slow video to 0.5–1× speed"],
    script:
      "I'm unemployed. Tell me the craziest thing that actually worked for you while job hunting.",
    caption: "What is your strategy? 🤔\n#jobsearch #jobhunt #aihirlyai #jobtips #unemployed",
  },
  {
    title: "Lost Job After Accepting Offer",
    exampleLabel: "Sofia's 282K Video",
    exampleUrl:
      "https://www.instagram.com/reel/DVukG5SEXps/?utm_source=ig_web_copy_link&igsh=NTc4MTIwNjQ2YQ==",
    additionalExamples: [
      {
        label: "Nat's 25K Video",
        url: "https://www.tiktok.com/@natjobhunt/photo/7621939313709813006",
      },
    ],
    audioUrl: "https://www.instagram.com/reels/audio/26045913568383273/",
    guidelines: ["Picture of yourself crying / looking sad"],
    script:
      "Me when I accept a new job offer and they rescind it after I already quit my other job.",
    caption:
      "I'm actually so mad right now 😭 at least I have 3 new job interviews lined up thanks to Hirly\n#joboffer #jobhunting #jobrescinded #unemployed #lostjob #aihirlyai",
  },
  {
    title: "Me Trying Not To Get Attached To A Job",
    exampleLabel: "Britney's 145K Video",
    exampleUrl: "https://www.instagram.com/reel/DZP8VA9BIwo/?igsh=NTc4MTIwNjQ2YQ==",
    audioUrl: "https://www.tiktok.com/music/original-sound-7251705883959528238",
    guidelines: ["Record yourself walking on a street"],
    script: "Me trying not to get attached to a job after one good interview",
    caption:
      "just choosing to appreciate the walk back home 😢\n#interview #jobinterview #unemployment #unemployed #manifesting",
  },
];

export function warmUpPostsToBlocks(posts, lang = "en") {
  const labels = blockLabels(lang);
  const blocks = [
    paragraph(labels.warmUpIntro),
    {
      type: "callout",
      variant: "info",
      text: labels.warmUpPayoutNote,
    },
  ];

  posts.forEach((post) => {
    const exampleItems = [
      { label: post.exampleLabel, url: post.exampleUrl },
      ...(post.additionalExamples || []),
    ].filter((item) => item.url);

    blocks.push(
      heading(2, post.title),
      examplesGrid(exampleItems),
      heading(3, labels.guidelines),
      {
        type: "list",
        style: "bullet",
        items: [
          post.audioUrl ? { text: labels.linkToAudio, href: post.audioUrl } : labels.linkToAudio,
          ...post.guidelines,
        ],
      },
      heading(3, labels.mainScript),
      infoScript(post.script),
      heading(3, labels.videoCaption),
      paragraph(post.caption),
    );
  });

  return blocks;
}
