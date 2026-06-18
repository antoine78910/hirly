/** Warm Up Posts — reference videos + trending audio links. */

export const WARM_UP_POSTS_EN = [
  {
    title: "Never Going Into a Job Interview Scared Again",
    exampleLabel: "Britney's 100K Video",
    exampleUrl: "",
    audioUrl: "",
    guidelines: ["Smile and slow video to 0.5–1× speed"],
    script:
      "Never going into a job interview scared again because it's basically a free open mic session where I talk about how awesome and spectacular I am",
    caption:
      "Can someone hire me pls? i've been searching everywhere on Linkedin, Indeed, Hirly, Glassdoor…\n#jobapplication #jobsearch #recruitment #jobmarket #interview",
  },
  {
    title: "I Know It's Really Cooked For Me",
    exampleLabel: "Britney's 303K Video",
    exampleUrl: "",
    audioUrl: "",
    guidelines: ["Shaky finger pointing at camera, look shocked"],
    script:
      "My friend who graduated summa cum laude, had two big tech internships, and president of their consulting club telling me they haven't found a job so now I know it's REALLY cooked for me",
    caption:
      "Going to a school with cracked ppl really put a toll on my mental…\n#recruitment #jobapplication #collegelife #jobsearch #aihirlyai",
  },
  {
    title: "Until You Secure THAT BAG",
    exampleLabel: "Britney's 610K Video",
    exampleUrl: "",
    audioUrl: "",
    guidelines: ['Type on laptop and open mouth at the "AHHH" sound'],
    script:
      "When you finally get an email saying you made it to the next round of interviews but you don't want to celebrate just yet until you secure THAT BAG",
    caption:
      "I hate doing interviews omfgg\n#recruitment #jobapplication #jobmarket #aihirlyai",
  },
  {
    title: "Job Market So Bad…",
    exampleLabel: "Sofia's 303K Video",
    exampleUrl: "",
    audioUrl: "",
    guidelines: ["Smile, blink a lot, thumbs up"],
    script: "Job market so bad I'm interviewing to be hostess with an ivy league degree",
    caption:
      "How much does it take to get a job now 😭😭\n#jobmarket #jobapplication #aihirlyai #jobinterview #unemployed",
  },
  {
    title: "I'm Done Applying to Jobs",
    exampleLabel: "Britney's 590K Video",
    exampleUrl: "",
    audioUrl: "",
    guidelines: ["Look sad while typing on your laptop"],
    script:
      "I'm done applying to jobs because clearly everyone hates me and wants me to die",
    caption:
      "I've used Linkedin, Indeed, and Glassdoor for my job search and NO ONE REPLIES TO ME 😭\nBut I have heard that niche job apps are the way to go (from my bestie lol), so far I've tried Hirly, Discord, and those Instagram influencer groupchat things 😂😂\n#recruitment #jobsearch #jobapplication #jobboard #aihirlyai",
  },
  {
    title: "Tell Me the Craziest Job Hunting Hack",
    exampleLabel: "Britney's 546K Video",
    exampleUrl: "",
    audioUrl: "",
    guidelines: ["Cross hands/arms and slow video to 0.5–1× speed"],
    script:
      "I'm unemployed. Tell me the craziest thing that actually worked for you while job hunting.",
    caption:
      "What is your strategy? 🤔\n#jobsearch #jobhunt #aihirlyai #jobtips #unemployed",
  },
  {
    title: "Lost Job After Accepting Offer",
    exampleLabel: "Sofia's 282K Video / Nat's 25K Video",
    exampleUrl: "",
    audioUrl: "",
    guidelines: ["Picture of yourself crying / looking sad"],
    script:
      "Me when I accept a new job offer and they rescind it after I already quit my other job.",
    caption:
      "I'm actually so mad right now 😭 at least I have 3 new job interviews lined up thanks to Hirly\n#joboffer #jobhunting #jobrescinded #unemployed #lostjob #aihirlyai",
  },
  {
    title: "Me Trying Not To Get Attached To A Job",
    exampleLabel: "Britney's 145K Video",
    exampleUrl: "",
    audioUrl: "",
    guidelines: ["Record yourself walking on a street"],
    script: "Me trying not to get attached to a job after one good interview",
    caption:
      "just choosing to appreciate the walk back home 😢\n#interview #jobinterview #unemployment #unemployed #manifesting",
  },
];

/** FR uses same scripts/captions (filmed in EN); labels translated where helpful. */
export const WARM_UP_POSTS_FR = WARM_UP_POSTS_EN.map((post) => ({
  ...post,
  exampleLabel: post.exampleLabel
    .replace("Britney's", "Vidéo de Britney —")
    .replace("Sofia's", "Vidéo de Sofia —")
    .replace(" / Nat's 25K Video", " / Vidéo 25K de Nat"),
}));

function linkBlock(text, href) {
  if (href) return { type: "link", text, href };
  return { type: "paragraph", text };
}

export function warmUpPostsToBlocks(posts) {
  const blocks = [
    {
      type: "callout",
      variant: "info",
      text: "Warm Up Posts receive 50% of the standard content payout. You must add #aihirlyai to the caption for tracking purposes.",
    },
    {
      type: "paragraph",
      text: "Warm-Up Posts are creator-tested content formats from other Hirly creators that can help boost engagement and activity on your account. These posts are especially useful if you're just getting started in the program, or if you've noticed your recent content is getting fewer views than usual and want to help \"warm up\" your account again.",
    },
  ];

  posts.forEach((post) => {
    blocks.push(
      { type: "heading", level: 2, text: post.title },
      linkBlock(post.exampleLabel, post.exampleUrl),
      { type: "heading", level: 3, text: "Guidelines" },
      {
        type: "list",
        style: "bullet",
        items: [
          post.audioUrl
            ? { text: "Link to Audio", href: post.audioUrl }
            : "Link to Audio",
          ...post.guidelines,
        ],
      },
      { type: "heading", level: 3, text: "Main Script" },
      { type: "callout", variant: "info", text: post.script },
      { type: "heading", level: 3, text: "Video Caption" },
      { type: "paragraph", text: post.caption },
    );
  });

  return blocks;
}
