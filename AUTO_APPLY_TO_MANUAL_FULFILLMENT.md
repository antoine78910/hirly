# Auto-Apply System and Manual Fulfillment Handoff

## Current State

Hirly currently generates an application package when a user swipes right on a job:

- The backend loads the user profile and job.
- The AI generates a tailored resume structure, cover letter, application answers, match score, and interview prep.
- The document builder attempts to create a tailored CV file.
- The application is saved in `applications`.
- The admin application queue can show the user profile, job details, generated CV, generated cover letter, answers, notes, assignment, and manual status.

The product now treats right swipes as a request for manual application fulfillment. A generated application is placed in the admin queue with `manual_status=manual_review_needed`. An operator opens the admin detail page, downloads or copies the generated documents, opens the original job application URL, and completes the application manually.

## Why One-Swipe Auto-Apply Did Not Work Reliably

The one-swipe model assumed that most applications could be completed automatically after generating the documents. In practice, the hard part was not creating the CV or cover letter; it was submitting the application on external websites.

Main blockers:

- Job boards are inconsistent. Greenhouse, Lever, Ashby, Workday, company career pages, and custom forms all expose different field names, validation rules, upload behavior, and required questions.
- Many applications include dynamic required fields. Examples include visa status, work authorization, salary expectations, demographic questions, location preferences, availability dates, consent checkboxes, and role-specific questions.
- Some answers cannot be invented. The system must not guess personal legal or employment information, so missing fields often require a human/user answer.
- Browser automation is fragile. Cookie banners, CAPTCHA, bot protection, multi-step forms, disabled submit buttons, async validation, and upload widgets break one-click flows.
- Real submission has high risk. A bad automated submit can send incorrect information to an employer, duplicate applications, or submit before the user/operator has verified the package.
- Provider APIs are limited. Even when a public API exists, it often supports only part of the form or fails on custom fields.
- Debugging is slow. The failure happens on third-party pages outside our control, often only visible in screenshots/logs after the attempt.

Because of these constraints, one-swipe direct submission was not reliable enough for production. It made the app feel broken even when the useful part, generating high-quality tailored documents, worked.

## New Operating Model

For now, right swipe means:

1. User chooses a job and swipes right.
2. Hirly checks credits.
3. Hirly generates the tailored application package.
4. Hirly saves the application with:
   - `submission_status=not_submitted`
   - `manual_status=manual_review_needed`
   - `admin_status=manual_review_needed`
5. The admin queue receives the application.
6. An operator manually completes the application using:
   - user contact/profile information
   - original CV text
   - tailored CV file
   - tailored cover letter
   - generated application answers
   - job application URL
   - notes and status controls
7. The operator marks the application as:
   - `manual_in_progress`
   - `manually_submitted`
   - `manual_blocked`
   - `needs_user_input`

## Admin Workflow

Use `/admin/applications` as the operations queue.

Recommended flow:

1. Filter by `Needs Human Completion`.
2. Open an application detail page.
3. Assign it to yourself.
4. Open the job application URL.
5. Download the tailored CV.
6. Copy/download the cover letter.
7. Use user contact info, application defaults, resolved answers, and CV text to complete the form.
8. Add an internal note when needed.
9. Mark status:
   - `Start Manual Completion` when beginning.
   - `Mark Manually Submitted` after submission.
   - `Mark Needs User Input` if the operator needs missing information from the user.
   - `Mark Manual Blocked` if the employer form cannot be completed.

## Code Behavior

Manual fulfillment is controlled by:

```env
MANUAL_APPLICATION_FULFILLMENT=true
```

This defaults to `true` in code. While enabled, the after-swipe Greenhouse browser preparation path does not run. The legacy Greenhouse preparation and submission endpoints still exist for future internal experiments, but they are no longer part of the default right-swipe path.

## Future Rebuild Direction

If auto-apply is revisited, it should be rebuilt as a supervised operator workflow first:

- Prepare a form payload.
- Show every field, answer, file, and validation issue to an admin.
- Let the admin approve or correct values.
- Submit only after explicit admin confirmation.
- Keep browser/API submit per provider behind feature flags.

Only after that works reliably per provider should direct user-facing one-swipe submission be considered again.
