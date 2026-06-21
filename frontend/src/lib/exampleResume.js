/** Sample resume (Kyle Hoffmann) used in empty states and demo mode previews. */
export const EXAMPLE_RESUME = {
  previewUrl: "/examples/kyle-hoffmann-resume.png",
  cv_filename: "Kyle_Hoffmann_Resume.pdf",
  cv_mime: "image/png",
  template_style: "modern",
  target_role: "Entry-Level Server",
  target_roles: ["Entry-Level Server", "Server", "Hospitality"],
  target_location: "Los Angeles, CA",
  target_location_data: { location_label: "Los Angeles, CA", country_code: "US" },
  remote_preference: "onsite",
  seniority: "entry",
  contact: {
    first_name: "Kyle",
    last_name: "Hoffmann",
    name: "Kyle Hoffmann",
    email: "Kyle.Hoffmann@example.com",
    phone: "(555) 555-5555",
    location: "Los Angeles, CA, 90001",
  },
  skills: [
    "Customer Service",
    "Inventory Management",
    "Cash Handling",
    "Team Collaboration",
  ],
  experience: [
    {
      role: "Entry-Level Server",
      company: "Urban Fork",
      location: "Los Angeles, CA",
      duration: "Aug 2024 – Aug 2025",
      highlights: [
        "Assisted 50+ customers daily, ensuring high satisfaction rates.",
        "Maintained inventory levels, reducing shortages by 20%.",
        "Collaborated with team to improve workflow efficiency by 15%.",
      ],
    },
    {
      role: "Assistant Server",
      company: "Harborview Bistro",
      location: "Long Beach, CA",
      duration: "Aug 2023 – Aug 2024",
      highlights: [
        "Supported senior staff, enhancing service speed by 10%.",
        "Managed cash transactions totaling $50,000+ monthly.",
        "Trained new employees, improving team service quality by 25%.",
      ],
    },
  ],
  education: [
    {
      degree: "Bachelor's Degree, Hospitality Management",
      school: "New York University — New York, NY",
      year: "2018 – 2022",
    },
    {
      degree: "High School Diploma, General Studies",
      school: "New York High School — New York, NY",
      year: "",
    },
  ],
  certifications: [
    "Certified Food Manager — National Restaurant Association",
    "First Aid Certification — American Red Cross",
  ],
  languages: [
    { name: "Spanish", level: "Beginner (A1)" },
    { name: "French", level: "Beginner (A1)" },
    { name: "Mandarin", level: "Beginner (A1)" },
  ],
  cv_text: `Kyle Hoffmann
Los Angeles, CA, 90001
(555) 555-5555
Kyle.Hoffmann@example.com

SUMMARY
Energetic Entry-Level Server with strong customer service skills, adept at inventory management and team collaboration, seeking to leverage hospitality training to enhance service quality.

EDUCATION
Bachelor's Degree: Hospitality Management — New York University, New York, NY (2018 – 2022)
High School Diploma: General Studies — New York High School, New York, NY

SKILLS
Customer Service, Inventory Management, Cash Handling, Team Collaboration

WORK HISTORY
Entry-Level Server — Urban Fork, Los Angeles, CA (Aug 2024 – Aug 2025)
• Assisted 50+ customers daily, ensuring high satisfaction rates.
• Maintained inventory levels, reducing shortages by 20%.
• Collaborated with team to improve workflow efficiency by 15%.

Assistant Server — Harborview Bistro, Long Beach, CA (Aug 2023 – Aug 2024)
• Supported senior staff, enhancing service speed by 10%.
• Managed cash transactions totaling $50,000+ monthly.
• Trained new employees, improving team service quality by 25%.

CERTIFICATIONS
Certified Food Manager — National Restaurant Association
First Aid Certification — American Red Cross

LANGUAGES
Spanish — Beginner (A1)
French — Beginner (A1)
Mandarin — Beginner (A1)`,
};

/** Profile-shaped object for preview components. */
export function exampleResumeProfile() {
  return {
    cv_filename: EXAMPLE_RESUME.cv_filename,
    cv_mime: EXAMPLE_RESUME.cv_mime,
    cv_preview_url: EXAMPLE_RESUME.previewUrl,
    cv_text: EXAMPLE_RESUME.cv_text,
    contact: EXAMPLE_RESUME.contact,
  };
}

export function downloadExampleResume() {
  const anchor = document.createElement("a");
  anchor.href = EXAMPLE_RESUME.previewUrl;
  anchor.download = EXAMPLE_RESUME.cv_filename.replace(/\.pdf$/i, ".png");
  anchor.click();
}
