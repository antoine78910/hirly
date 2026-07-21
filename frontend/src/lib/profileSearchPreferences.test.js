import {
  onboardingSnapshotToSearchSync,
  resolveProfileSearchPreferences,
} from "./profileSearchPreferences";

describe("profileSearchPreferences", () => {
  it("falls back to onboarding role and city when target fields are empty", () => {
    const prefs = resolveProfileSearchPreferences({
      extras: {
        onboarding: {
          selected_roles: ["Software Engineer"],
          onboarding_location: "Paris, France",
          onboarding_location_data: { location_label: "Paris, France", country_code: "fr" },
        },
      },
    });
    expect(prefs.role).toBe("Software Engineer");
    expect(prefs.location).toBe("Paris, France");
    expect(prefs.locationData.country_code).toBe("fr");
  });

  it("prefers explicit profile target fields", () => {
    const prefs = resolveProfileSearchPreferences({
      target_role: "Data Analyst",
      target_location: "Lyon, France",
      extras: {
        onboarding: {
          selected_roles: ["Chef de projet"],
          onboarding_location: "Marseille, France",
        },
      },
    });
    expect(prefs.role).toBe("Data Analyst");
    expect(prefs.location).toBe("Lyon, France");
  });

  it("maps onboarding snapshot for sync helper", () => {
    expect(
      onboardingSnapshotToSearchSync({
        selected_roles: ["Designer"],
        onboarding_location: "Nantes, France",
        contract_type: "permanent",
        experience: "mid",
      }),
    ).toEqual({
      selectedRoles: ["Designer"],
      onboardingLocation: "Nantes, France",
      onboardingLocationData: null,
      contractType: "permanent",
      experienceId: "mid",
    });
  });
});
