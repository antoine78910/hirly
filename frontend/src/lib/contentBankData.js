/** Content Bank Examples — structured data with optional reference links. */

import {
  bulletList,
  examplesGrid,
  heading,
  infoScript,
  linkBlock,
  paragraph,
  sectionBlock,
  warningGuideline,
} from "./trainingDocBlocks";

const BRAND_ASSETS_DRIVE_URL =
  "https://drive.google.com/drive/folders/1_6Q7rK8LbzAHu4CUqpx6R0HkIhfrZZ4b?usp=sharing";

/** Shorthand: { label, url? } */
function ex(label, url = "") {
  return url ? { label, url } : label;
}

const CONTENT_BANK_EN = [
  sectionBlock({
    section_id: "sec_cb_websites",
    title: "3 Websites to Gatekeep",
    content: [
      heading(1, "3 Websites You Should Gatekeep"),
      heading(3, "Examples"),
      examplesGrid([
        ex("Anara Version / Turbo Version", "https://www.instagram.com/reels/DVfgvqZjVMj/"),
        ex(
          "Keep Up Tools Version",
          "https://www.tiktok.com/@keepuptools/video/7225134046781705478?_r=1&_t=ZP-95NfUynjgoo",
        ),
        ex(
          "Riyaj's 3M Video",
          "https://www.tiktok.com/@keepuptools/video/7225134046781705478?_r=1&_t=ZP-95NfUynjgoo",
        ),
        ex("Kayla's 107K Video", "https://www.instagram.com/reel/DYVHtyRxliQ/"),
        ex(
          "Cleo's 140K Video",
          "https://www.instagram.com/reel/DXLK4UDD_YE/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==",
        ),
        ex("Michala's 116K Video", "https://www.instagram.com/reel/DYVHtyRxliQ/"),
        ex(
          "Karen's 115K Video",
          "https://www.instagram.com/reel/DYOe-zAy0Go/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==",
        ),
      ]),
      heading(3, "Guidelines"),
      warningGuideline("Make sure to show the actual websites you're talking about in the video!"),
      heading(3, "Caption Examples"),
      paragraph(
        "No more wasted mcd trips on broken McFlurry machines Also please use vpn and ad block with these streaming sites 😭🙏 #college #university #fypage #websites #mcdonalds\nUse ad blocker for streaming!! Websites: vidbox.cc, Hirly, bored.com #websites #streaming #jobsearch\napps that feels illegal to know #website #websites #apps #onlinetools",
      ),
      heading(2, "Main Script"),
      infoScript(
        "Here are three websites that you should keep a secret because they are just too good. This website gives you access to all the streaming providers. Netflix, Disney+, Prime Video. You can find and watch anything for free. The second one is Hirly. You can upload your resume once and it'll tailor your resume and cover letter for every job and even apply directly to the company websites for you. It's dangerous because what if you actually start getting interviews? And the last one is for all the big backs out there. This website shows you which McDonald ice cream machines are working. Just search your location and you can check the exact store. Save this video for yourself and remember that it came from me.",
      ),
      heading(2, "Variation 1"),
      infoScript(
        "There are three websites you should keep a secret because they are just too good. This website gives you access to a bunch of streaming providers and you can literally watch anything for free.\n\nThe second one is Hirly. All you have to do is upload your resume and swipe right on the jobs that you want to apply for. Also, it sends a tailored cover letter and resume directly to the companies.\n\nAnd the next one is Bored.com which has a bunch of fun, interesting, and cool websites for you to check out and they're also interactive.",
      ),
      heading(2, "Variation 2"),
      infoScript(
        "3 powerful apps that feels illegal to know.\nNumber 1 is this application. You will be able to get the passwords of Wi-Fi that are in your area.\n\nNumber 2 is this application. You will be able to download anything you want just by typing the name of it.\n\nNumber 3 is this application (have the Hirly name on-screen for full comp). You upload your resume once and it tailors your resume and cover letter for every job you apply to. It'll even auto-apply directly on the company websites for you.",
      ),
      heading(2, "Variation 3"),
      infoScript(
        "Websites that feel illegal to know that literally no one talks about. If you go to this website over here, you can download any paid apps for free. You can download stuff like CapCut Pro, paid games, and also Spotify Premium. Even these streaming services will have free subscriptions. There are apps for all your needs on this website.\n\nNext up, this one is for job searching. If you go on Hirly, you upload your resume once and it literally tailors your resume and cover letter for every job you apply to. It'll even auto-apply directly on the company websites for you. I started using it and now I actually have interviews lined up, which is kind of insane.\n\nLastly, for all my gym rats, if you go to this website, you can click on any of these muscle groups. So if you want big gluteus maximus like me, just click on it, and then it tells you exactly what kind of workouts you need. Like and follow for more. Cheers.",
      ),
      heading(2, "Variation 4"),
      infoScript(
        "Here are three websites that schools don't want you to know about. This website gives you access to all the streaming providers, Netflix, Disney+, Prime Video, and even Crunchyroll. They have different language servers, and the video quality is actually amazing. Just make sure you still pay attention to your lectures.\n\nThe second one is Hirly. All you have to do is upload your resume and swipe right on the internships that you want to apply for. Also, it sends a tailored cover letter and resume directly to the companies.\n\nAnd the last one is for anyone taking chemistry. You just enter any chemical equation and it will balance it out for you. This way you can visualize it and check your work. Let's just hope that your chem teacher still has a job after you use this. Save this for your future reference and I hope we all become academic weapons.",
      ),
    ],
  }),

  sectionBlock({
    section_id: "sec_cb_gbb",
    title: "Good. Better. Best.",
    badge: "Top format",
    content: [
      heading(1, "Good. Better. Best."),
      heading(3, "Examples"),
      examplesGrid([
        ex(
          "Maryam's 1.4M Video",
          "https://www.tiktok.com/@that.corporate.blackgirl/video/7629405559799893268",
        ),
        ex(
          "Cleo's 2.4M Video",
          "https://www.instagram.com/reel/DXF6h7Tj4bO/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==",
        ),
        ex("Ava's 3.2M Video", "https://www.instagram.com/reels/DXYCByYCueO/"),
        ex("Eylul's 500K Video", "https://www.instagram.com/reel/DYOD3hThFov/"),
        ex(
          "John's 100K Video",
          "https://www.tiktok.com/@johnseekingjob/video/7631983608885939486",
        ),
      ]),
      heading(3, "Guidelines"),
      warningGuideline(
        "Hold/Do something else while speaking. Point to the categories (Good, Better, Best) when you are addressing them.",
      ),
      heading(3, "Video Captions"),
      paragraph("Good, better, best: Job application edition! #jobsearch #jobapplication #linkedin #indeed #careeradvice"),
      heading(2, "Main Script"),
      infoScript(
        "Good. Better. Best. Job application edition.\n\nGood. LinkedIn and Indeed.\nYour standard job platforms. You see they use tons of listings, but you're competing with hundreds of applicants and most of the times it's a hit or miss.\n\nBetter. Handshake. More curated, especially for students. You'll find internships and early career roles, but you still have to apply to everything yourself.\n\nBest. Hirly. All you have to do is swipe right on the jobs you want and it auto-applies to hundreds of applications without you needing to do anything. It generates a tailored resume and cover letter per role and submits directly on the company's website.",
      ),
    ],
  }),

  sectionBlock({
    section_id: "sec_cb_linkedin",
    title: "LinkedIn Reminder",
    badge: "Top format",
    content: [
      heading(1, "Friendly Reminder to Those Still Using LinkedIn"),
      heading(3, "Examples"),
      examplesGrid([
        ex(
          "Rene's 100K Video",
          "https://www.tiktok.com/@careerwith.rene/video/7560449753025219862?is_from_webapp=1&sender_device=pc",
        ),
        ex(
          "Sarah's 55K Video",
          "https://www.tiktok.com/@careerwithsarah/video/7575267000725900599?lang=en",
        ),
        ex("Riyaj's 2.3M Video", "https://www.facebook.com/reel/985734247469241"),
        ex(
          "Tony's 1.3M Video",
          "https://www.tiktok.com/@tony_w21/video/7606508525233147157?lang=en-GB",
        ),
        ex("Heynavii.ai Example", "https://www.instagram.com/reels/DTwS6RTCa3A/"),
        ex("Different Variation", "https://www.instagram.com/p/DTRe98gkeG-/"),
      ]),
      paragraph(
        "Keep it simple and straight to the point, 15–20 seconds long, be high energy and have a fast pace of talking.",
      ),
      heading(3, "Guidelines"),
      warningGuideline(
        'Requires LinkedIn. When you show the app, include the word "Hirly" on the in-video text → "Apparently there\'s this app called Hirly that lets you…"\nMove around in the first 3 seconds and instantly flip the camera to show LinkedIn → movement is a visual hook.',
      ),
      heading(3, "Captions"),
      paragraph(
        "Video Text Hook:\n• Friendly reminder for those still using LinkedIn 🤨‼️\n• Job searching in 2026 is a humiliation ritual\n\nOut of Video Caption:\nIf you're only using LinkedIn and Indeed, you're competing with hundreds of applicants on the same listings.\n#jobsearch #jobsearchtips #remotejobs #jobapplication #careergrowth",
      ),
      heading(2, "Main Script"),
      infoScript(
        "Friendly reminder that job searching in 2026… [Show scroll of applying to jobs on LinkedIn] …is literally a humiliation ritual. [Flip back camera to you] Cos look at what my friend just showed me [Flip camera to Hirly] Apparently there's this app called Hirly where all you have to do is upload your resume. It shows you all these jobs, and every time you swipe right, the AI applies on the company's website with a personalized resume and cover letter for that role. It even asks a few quick, job-specific questions so every application is actually tailored. Crazy…",
      ),
      heading(2, "Variation 1"),
      infoScript(
        "Friendly reminder… [Show scroll of applying to jobs on LinkedIn] THIS is literally a complete waste of time now. [Flip back camera to you] Because look at what my friend just showed me. [Flip camera to Hirly] Apparently there's this app called Hirly where all you have to do is upload your resume. It shows you all these jobs and every time you swipe right, AI applies on the company website for you with a personalized resume and cover letter.",
      ),
    ],
  }),

  sectionBlock({
    section_id: "sec_cb_100k",
    title: "100K Salary Platforms",
    content: [
      heading(1, "Job Platforms That Landed Me a 100K Salary"),
      heading(3, "Examples"),
      examplesGrid([
        ex("Riyaj's 142K Video", "https://www.facebook.com/reel/2679321229131031"),
      ]),
      heading(3, "Guidelines"),
      warningGuideline("Position yourself as the expert. Use a visual prop — pouring drink, mixing matcha."),
      heading(3, "Caption"),
      paragraph(
        "Video Text Hook: Job platforms that landed me a 100k salary\nOut of Video Caption: Try these out #jobapplication #university #graduation #jobmarket",
      ),
      heading(2, "Main Script"),
      infoScript(
        "Imma give you every single website that me and my friends used to get a six figure job and no you don't need to use LinkedIn, you don't need to use Indeed.\n\nYou just need to understand the concept of leverage.\n\nSo here are three websites that you can use.\n\nPersonally I love the second one.\n\nThe first website is Google Careers. Literally just search for a role and Google will pull out all of these listings from all over the internet. You can filter by location, salary, and even remote ones.\n\nThe second website is Hirly. You just upload your resume and look to jobs, and every time you click apply, the AI just applies for you on the company website. It is that simple. Every application has a customized cover letter and resume.\n\nThe third website is Handshake. It has thousands of opportunities for students and recent grads that most people completely overlook.",
      ),
    ],
  }),

  sectionBlock({
    section_id: "sec_cb_website_made",
    title: "I Made a Website Called",
    content: [
      heading(1, "I Made a Website Called…"),
      heading(3, "Examples"),
      examplesGrid([
        ex("Riyaj's 730K Video (Prep AI)", "https://www.tiktok.com/t/ZTBMhK1T1/"),
        ex(
          "Simon's 7K Video",
          "https://www.instagram.com/reel/DYyYzNJsn6h/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==",
        ),
      ]),
      heading(3, "Guidelines"),
      warningGuideline(
        'Add a slight pause before saying "dot com" for emphasis. Sound DEADPAN/MONOTONE while saying "dot com".',
      ),
      heading(3, "Caption"),
      paragraph(
        "Video Text Hook: I made a website called…\nOut of Video Caption: watch this if you haven't got a job lined up yet😳 #recruitment #internship #jobsearch #jobtips #asian #jobapplication",
      ),
      heading(2, "Main Script"),
      infoScript(
        "I made a website called… [New camera angle closer to your face, bottom up]\nI'm graduating soon and I need to apply to like a thousand jobs but I haven't even started yet.com.\nIt's a website for people looking to apply to a lot of jobs but also want to save a hell of a lot of time.\n[Show Hirly tutorial]\nAll you have to do is go on Hirly and then upload your resume. Then you head over to apply and simply start swiping right to apply for the job. If you don't want the job, just swipe left. Literally, AI just automatically applies for you. You can even track your job applications that you've sent out in the past.\n[Camera back to you]\nYou could probably send out like 100 applications in the next half an hour or so.",
      ),
    ],
  }),

  sectionBlock({
    section_id: "sec_cb_marry",
    title: "Marry/Kiss Trending",
    content: [
      heading(1, "Song Trending Video: I Could MARRY/KISS the Person That Showed Me This"),
      heading(3, "Examples"),
      examplesGrid([
        ex("Britney's 40K Video", "https://www.instagram.com/reels/DVZmZ1Xkoix/"),
        ex(
          "Sarah's 40K Video",
          "https://www.tiktok.com/@careerwithsarah/video/7618403948361190670?_r=1&_t=ZP-95OIBEdrNrb",
        ),
        ex(
          "Nicole J's 155K Video (spreadsheet variant)",
          "https://www.instagram.com/reels/DVjze1Iib6K/",
        ),
        ex(
          "Carol's 15K Video (spreadsheet variant)",
          "https://www.instagram.com/reels/DW7TF7tiZyz/",
        ),
      ]),
      heading(3, "Guidelines"),
      warningGuideline(
        "Face first, then flip screen to show Hirly demo. Add emojis to your on-screen text too!\nLink to the job spreadsheet in your caption.",
      ),
      heading(3, "Video Text Hook"),
      bulletList([
        "I could MARRY/KISS the person that showed me this",
        "I could MARRY/KISS the google employee who showed me this 🤯🤯",
        "Whoever showed me this is getting their toe SUCKED🤯🤯",
      ]),
      heading(3, "Out of Video Caption"),
      bulletList([
        "I will never manually apply to jobs again #recruitment #college #jobhunt #internship",
        "I fear this changed my life 😭 #jobsearch #recruitment #college #jobhunt #internship",
      ]),
      heading(2, "Main Script"),
      infoScript(
        '[FIRST CLIP] Act shocked/hand covering mouth, flip screen to Hirly\n\n[NEXT CLIP] On-Screen Text (have these texts pop up as you are showing the UI):\n\n"find the job you want"\n"upload your resume onto Hirly"\n"swipe right on jobs"\n"the ai auto-applies with a tailored resume/cover letter for every listing"\n"directly on the company\'s website"',
      ),
      heading(2, "Variation"),
      infoScript(
        '[FIRST CLIP] Act shocked/hand covering mouth, flip screen to Hirly\n\n[NEXT CLIP] On-Screen Text (have these texts pop up as you are showing the UI):\n\n"upload your resume"\n"swipe right on jobs with a tailored application"\n"the app/website is called Hirly btw"',
      ),
    ],
  }),

  sectionBlock({
    section_id: "sec_cb_ungatekeep",
    title: "Ungatekeeping 6-Figure Sites",
    content: [
      heading(1, "Ungatekeeping the Three Sites That Can Land You a 6-Figure Job This Summer"),
      heading(3, "Examples"),
      examplesGrid([
        ex(
          "Jhyrom's 600K Video",
          "https://www.instagram.com/reel/DWDBUe6DHWd/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==",
        ),
        ex("Kate's 43K Video", "https://www.instagram.com/reel/DWl1SyRjSL8/?igsh=Mzc3ZTVlOWMwZA=="),
        ex(
          "Ava's 18K Video",
          "https://www.instagram.com/reel/DX8SwqIKl2v/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==",
        ),
        ex(
          "Maryam's 25K Video",
          "https://www.tiktok.com/@that.corporate.blackgirl/video/7624707570053238036",
        ),
      ]),
      heading(3, "Captions"),
      paragraph(
        "Video Text Hook:\n• Ungatekeeping the three sites that can land you a 6 figure job this summer\n• Ungatekeeping the three sites that landed me a $60/hr summer 2026 internship\n\nOut of Video Caption:\nTop 3 sites for a 2026 summer internship #internships #jobboards #employment #fyp #jobsearch #recruitment #college #jobhunt #internship",
      ),
      heading(2, "Main Script"),
      infoScript(
        "Appear in front of a big company (if you can't, just film urself walking/posing), displaying the text hook exactly as in the reference video.\n\nUngatekeeping the three sites that landed me a $60/hr summer 2026 internship.\n\nShow your laptop screen, then scroll through GitHub job repos.\n1. Hiring Cafe — Show your laptop screen, then scroll through hiring cafe.\n2. Show Hirly on your screen, turn on your AI-generated resume, and swipe right to auto-apply.\n3. Google jobs — show your laptop screen, then scroll.",
      ),
      heading(3, "Guidelines"),
      warningGuideline(
        "Trending audio options to use for the video:\nhttps://www.instagram.com/reels/audio/26447457621525979/\nOR\nhttps://www.instagram.com/reels/audio/2267773183744321/",
      ),
    ],
  }),

  sectionBlock({
    section_id: "sec_cb_hired",
    title: "Hired vs Unemployed",
    content: [
      heading(1, "Hired vs Unemployed"),
      heading(3, "Examples"),
      examplesGrid([
        ex(
          "Cleo's 107K Video",
          "https://www.instagram.com/reel/DX-nfQbP3Aw/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==",
        ),
        ex(
          "Cleo's 116K Video",
          "https://www.instagram.com/reel/DX5V5dOvtrW/?utm_source=ig_web_copy_link&igsh=MzRlODBiNWFlZA==",
        ),
      ]),
      heading(3, "Guidelines"),
      warningGuideline(
        "Editing Tutorial\nVideo Assets\nNOTE: Dress in professional/business attire for hired persona and comfy/casual clothes for unemployed persona.",
      ),
      heading(3, "Caption"),
      paragraph(
        "Out of video caption example: Especially in this job market, always apply smarter, not harder #jobsearch #jobapplication #unemployed #hired #jobmarket",
      ),
      heading(2, "Main Script"),
      paragraph("U = Unemployed  |  H = Hired"),
      infoScript(
        "U: I practice my answers in my head 10 minutes before an interview.\nH: I record myself doing a mock interview to check body language, tone, and pacing.\n\nU: I give long stories when asked about my experience.\nH: I use the STAR method to keep my answers concise.\n\nU: I spend three hours a day manually applying to jobs.\nH: I swipe to auto-apply to hundreds of job listings on Hirly.",
      ),
      heading(2, "Variation 1"),
      infoScript(
        "U: I don't care about the interviewer.\nH: I researched the interviewers beforehand to understand the role in the company.\n\nU: I use the same resume and cover letter everywhere.\nH: I use Hirly to generate cover letters and resumes that are tailored to my job listing.\n\nU: I spend three hours a day applying to jobs.\nH: I use Hirly to auto-apply to hundreds of job listings in minutes.",
      ),
    ],
  }),

  sectionBlock({
    section_id: "sec_cb_secret_job_2026",
    title: "Secret Ways To Find A Job In 2026",
    content: [
      heading(1, "Secret Ways To Find A Job In 2026"),
      heading(3, "Examples"),
      examplesGrid([
        ex(
          "Maryam's 164K Video",
          "https://www.tiktok.com/@that.corporate.blackgirl/video/7608782339253996820",
        ),
        ex("Nicole J's 45K Video", "https://www.instagram.com/reels/DVJpW3FiVFz/"),
        ex("Original Video", "https://www.instagram.com/reels/DU7KlUREViT/"),
      ]),
      heading(3, "Guidelines"),
      warningGuideline("Requires laptop/second phone to record the job boards."),
      heading(3, "Caption"),
      paragraph(
        "Video Text Hook:\nSecret Ways to Find a Job in 2026\n\nOut of Video Caption:\n- You need to know about these two job sites if you actually want interviews.\n- If you're only using LinkedIn and Indeed, you're competing with hundreds of applicants on the same listings.\n#jobsearch #jobsearchtips #remotejobs #jobapplication #careergrowth",
      ),
      heading(2, "Main Script"),
      infoScript(
        "Nobody is hiring right now. Hmm. Maybe it's just you.\nAnd maybe you're just looking in the wrong places.\n\nIf you don't know about these two websites, let me put you on.\nOne of them is called FlexJobs, and it has over 200,000 verified jobs that nobody knows about.\n\nThe next one is called Hirly.\nThis one actually auto-applies to the company's website directly with a tailored cover letter and resume for each listing.\n\nSo let me know if anyone ends up using this.",
      ),
      heading(2, "Variation 1"),
      infoScript(
        "Nobody is hiring right now? Hmm. Maybe it's just you.\nAnd maybe you're just looking in the wrong places.\n\nIf you don't know about these two websites, let me put you on.\nOne of them is called Google Jobs — literally just search for a role on Google and it pulls listings from all over the internet. You can filter by location, salary, and even remote ones.\n\nThe next one is called Hirly. This one actually auto-applies directly on the company's website with a tailored cover letter and resume for each listing.\n\nSo let me know if anyone ends up using this 👀",
      ),
      heading(2, "Variation 2"),
      infoScript(
        "Nobody's hiring right now? Maybe it's just you.\nMaybe you're just looking in the wrong places.\n\nIf you don't know about these two websites, let me put you on.\nOne of them is called Handshake, and it has thousands of opportunities for students and recent grads that most people completely overlook.\n\nBut the next one?\nIt's called Hirly. Instead of you spending hours applying, it actually auto-applies directly on the company's website for you with a tailored resume and cover letter. You literally set your preferences, and it does the heavy lifting.\n\nSo if you're tired of filling out the same application over and over again, this might be the move.\n\nLet me know if any of you end up using it.",
      ),
    ],
  }),

  sectionBlock({
    section_id: "sec_cb_company_logos",
    title: "Company Logos",
    badge: "Top format",
    content: [
      heading(1, "Company Logos"),
      heading(3, "Guidelines"),
      linkBlock("Open the official Hirly logos folder (Google Drive)", BRAND_ASSETS_DRIVE_URL),
      warningGuideline(
        "Point to each tier (Good, Better, Best) on screen as you say it. Use transparent PNG logos from the shared folder for overlays — don't stretch, recolor, or add effects.",
      ),
      heading(3, "Video Captions"),
      paragraph("Good, better, best: Company logo edition! #contentcreation #hirly #brand #jobsearch"),
      heading(2, "Main Script"),
      infoScript(
        "Good. Better. Best. Company logo edition.\n\nGood. Screenshot the logo from Google or the company website.\nIt's blurry, the background is wrong, and it looks unprofessional in your video.\n\nBetter. Recreate the logo yourself or grab a random PNG from the internet.\nWrong colors, outdated version — the brand team will notice.\n\nBest. Use the official Hirly logo files from our shared Google Drive folder.\nTransparent PNG, correct colors, ready for video overlays. Link is in the Content Bank.\n\nSave this and always pull logos from the folder before you post.",
      ),
    ],
  }),
];

export const CONTENT_BANK_SECTIONS_EN = CONTENT_BANK_EN;
export { CONTENT_BANK_FR as CONTENT_BANK_SECTIONS_FR } from "./contentBankDataFr";
