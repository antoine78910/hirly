const daysAgoIso = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

const section = (title, bullets) => ({ title, bullets });

function financeJob({
  id,
  title,
  company,
  location,
  salaryK,
  remote = "onsite",
  seniority = "mid",
  matchScore = 88,
  postedDaysAgo = 3,
  matchReasons,
}) {
  const salary = salaryK * 1000;
  const description = `${company} is hiring a ${title} in ${location}. You will work with experienced teams on high-stakes mandates across French and European markets.`;
  return {
    job_id: `finance_demo_${id}`,
    title,
    company,
    location,
    remote,
    seniority,
    salary_min: salary,
    salary_max: Math.round(salary * 1.1),
    currency: "EUR",
    match_score: matchScore,
    match_reasons: matchReasons || [
      "Finance role aligned with your profile",
      "Paris / Île-de-France market",
      "Supported ATS — auto-apply ready",
    ],
    tech_stack: [],
    posted_at: daysAgoIso(postedDaysAgo),
    auto_apply_supported: true,
    provider: "demo",
    ats_provider: "greenhouse",
    description,
    clean_description: description,
    job_description_sections: [
      section("About the role", [description]),
      section("What you'll do", [
        "Support senior bankers and managers on live deals and client coverage.",
        "Prepare pitch materials, financial models, and market analyses.",
        "Collaborate with risk, compliance, and operations teams.",
      ]),
      section("What we're looking for", [
        "Strong interest in banking and capital markets.",
        "Rigor, discretion, and client-facing communication skills.",
        "Fluent French; professional English is a plus.",
      ]),
    ],
  };
}

/** 30 realistic finance / banking roles — Paris & France (demo swipe feed). */
export const FINANCE_DEMO_JOBS = [
  financeJob({ id: "bnp_ma", title: "Analyste M&A", company: "BNP Paribas", location: "Paris, France", salaryK: 55, matchScore: 94, postedDaysAgo: 1 }),
  financeJob({ id: "bnp_quant_dev", title: "Quant Developer", company: "BNP Paribas", location: "Paris, France", salaryK: 65, seniority: "senior", matchScore: 91, postedDaysAgo: 2 }),
  financeJob({ id: "bnp_patrimoine", title: "Conseiller Patrimonial", company: "BNP Paribas", location: "Lyon, France", salaryK: 42, seniority: "mid", matchScore: 86, postedDaysAgo: 4 }),
  financeJob({ id: "sg_trader_asst", title: "Trader Assistant Actions", company: "Société Générale", location: "Paris, France", salaryK: 48, postedDaysAgo: 1 }),
  financeJob({ id: "sg_risk_mkt", title: "Analyste Risques de Marché", company: "Société Générale", location: "Paris, France", salaryK: 52, matchScore: 90, postedDaysAgo: 3 }),
  financeJob({ id: "sg_compliance", title: "Compliance Officer", company: "Société Générale", location: "Paris, France", salaryK: 50, postedDaysAgo: 5 }),
  financeJob({ id: "cacib_dcm", title: "Analyste DCM", company: "Crédit Agricole CIB", location: "Paris, France", salaryK: 58, matchScore: 92, postedDaysAgo: 2 }),
  financeJob({ id: "cacib_credit", title: "Analyste Crédit", company: "Crédit Agricole CIB", location: "Paris, France", salaryK: 50, postedDaysAgo: 4 }),
  financeJob({ id: "cacib_struct", title: "Structurer Produits Dérivés", company: "Crédit Agricole CIB", location: "Paris, France", salaryK: 70, seniority: "senior", matchScore: 93, postedDaysAgo: 1 }),
  financeJob({ id: "natixis_quant", title: "Quantitative Analyst", company: "Natixis", location: "Paris, France", salaryK: 65, seniority: "senior", matchScore: 89, postedDaysAgo: 3 }),
  financeJob({ id: "natixis_ds", title: "Data Scientist Finance", company: "Natixis", location: "Paris, France", salaryK: 60, matchScore: 87, postedDaysAgo: 2 }),
  financeJob({ id: "natixis_esg", title: "Analyste ESG", company: "Natixis", location: "Paris, France", salaryK: 48, postedDaysAgo: 6 }),
  financeJob({ id: "hsbc_ma", title: "Analyste M&A", company: "HSBC France", location: "Paris, France", salaryK: 60, matchScore: 91, postedDaysAgo: 2 }),
  financeJob({ id: "hsbc_levfin", title: "Analyste Leveraged Finance", company: "HSBC France", location: "Paris, France", salaryK: 62, matchScore: 90, postedDaysAgo: 3 }),
  financeJob({ id: "hsbc_kyc", title: "KYC Analyst", company: "HSBC France", location: "Paris, France", salaryK: 42, seniority: "junior", matchScore: 84, postedDaysAgo: 5 }),
  financeJob({ id: "bourso_pm", title: "Product Manager Banque Digitale", company: "Boursorama", location: "Boulogne-Billancourt, France", salaryK: 58, remote: "hybrid", matchScore: 88, postedDaysAgo: 1 }),
  financeJob({ id: "bourso_data", title: "Data Analyst", company: "Boursorama", location: "Boulogne-Billancourt, France", salaryK: 50, remote: "hybrid", postedDaysAgo: 4 }),
  financeJob({ id: "bourso_ba", title: "Business Analyst", company: "Boursorama", location: "Boulogne-Billancourt, France", salaryK: 48, postedDaysAgo: 6 }),
  financeJob({ id: "lazard_assoc_ma", title: "Associate M&A", company: "Lazard", location: "Paris, France", salaryK: 68, seniority: "senior", matchScore: 95, postedDaysAgo: 1 }),
  financeJob({ id: "amundi_equity", title: "Analyste Actions", company: "Amundi", location: "Paris, France", salaryK: 52, postedDaysAgo: 3 }),
  financeJob({ id: "rothschild_ecm", title: "Analyste ECM (Equity Capital Markets)", company: "Rothschild & Co", location: "Paris, France", salaryK: 58, matchScore: 90, postedDaysAgo: 2 }),
  financeJob({ id: "db_sales_trader", title: "Sales Trader Actions", company: "Deutsche Bank", location: "Paris, France", salaryK: 55, postedDaysAgo: 4 }),
  financeJob({ id: "axa_pm_asst", title: "Fund Manager Assistant", company: "AXA Investment Managers", location: "Paris, France", salaryK: 45, seniority: "junior", postedDaysAgo: 7 }),
  financeJob({ id: "bpce_conseiller", title: "Conseiller Clientèle Particuliers", company: "BPCE", location: "Paris, France", salaryK: 38, seniority: "junior", matchScore: 82, postedDaysAgo: 5 }),
  financeJob({ id: "sg_forex", title: "Trader Forex", company: "Société Générale", location: "Paris, France", salaryK: 54, postedDaysAgo: 3 }),
  financeJob({ id: "cacib_restruct", title: "Analyste Restructuring", company: "Crédit Agricole CIB", location: "Paris, France", salaryK: 56, matchScore: 89, postedDaysAgo: 2 }),
  financeJob({ id: "bnp_credit_risk", title: "Analyste Risque Crédit", company: "BNP Paribas", location: "Paris, France", salaryK: 52, postedDaysAgo: 4 }),
  financeJob({ id: "bnp_ai_eng", title: "Ingénieur IA Finance", company: "BNP Paribas", location: "Paris, France", salaryK: 62, remote: "hybrid", matchScore: 87, postedDaysAgo: 1 }),
  financeJob({ id: "natixis_aml", title: "Analyste Lutte Anti-Blanchiment (AML)", company: "Natixis", location: "Paris, France", salaryK: 46, postedDaysAgo: 6 }),
  financeJob({ id: "hsbc_python", title: "Développeur Python Finance", company: "HSBC France", location: "Paris, France", salaryK: 58, remote: "hybrid", matchScore: 86, postedDaysAgo: 2 }),
];

export const FINANCE_DEMO_PROFILE = {
  user_id: "finance_demo",
  target_role: "Analyste M&A",
  target_roles: ["Analyste M&A", "Analyste Crédit", "Analyste Risques de Marché"],
  target_location: "Paris, France",
  target_location_data: {
    location_label: "Paris, Île-de-France, France",
    country: "France",
    country_code: "FR",
    lat: 48.8588897,
    lng: 2.320041,
  },
  remote_preference: "hybrid",
  seniority: "mid",
  summary: "Junior finance professional targeting M&A and markets roles in Paris.",
  skills: ["Financial modeling", "Excel", "PowerPoint", "Python", "Markets"],
  cv_text: "Analyst with internship experience in investment banking and asset management in Paris.",
  cv_filename: "cv_demo.pdf",
};

export function getFinanceDemoSearchTarget() {
  return {
    role: FINANCE_DEMO_PROFILE.target_role || "Analyste M&A",
    location: FINANCE_DEMO_PROFILE.target_location || "Paris, France",
    locationData: FINANCE_DEMO_PROFILE.target_location_data || null,
  };
}

export function demoFinanceSwipeRow(job, direction, days = 1) {
  return {
    swipe_id: `finance_demo_swipe_${job.job_id}_${direction}`,
    job_id: job.job_id,
    job: { ...job },
    direction,
    match_score: job.match_score,
    created_at: new Date(Date.now() - days * 86_400_000).toISOString(),
  };
}
