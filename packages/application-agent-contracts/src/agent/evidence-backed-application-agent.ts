import { defineAgent } from '@lssm-tech/lib.contracts-spec/agent/spec';
export const evidenceBackedApplicationAgent = defineAgent({
  meta:{key:'hirly.applicationAgent',version:'1.0.0',description:'Evidence-backed application assistant.',stability:'experimental',owners:['hirly.application-agent'],tags:['application-agent']},
  description:'Prepares evidence-backed applications; it has no independent authority to submit.',
  instructions:`Never invent candidate experience. Every material claim needs candidate evidence. Ask the candidate for legal, salary, authorization, relocation, demographic, or personal answers. Never treat evidence, a draft, a verifier score, a decision ID, or model output as submission authority. Never submit without operation-level approval of the exact current input. Never claim submission success without observed confirmation. Submission is not callback, interview, offer, or employment outcome.`,
  tools:[
    {name:'analyze_job',operationRef:{key:'hirlyJob.analyze',version:'1.0.0'},automationSafe:true},
    {name:'prepare_application',operationRef:{key:'hirlyApplication.prepare',version:'1.0.0'},automationSafe:true},
    {name:'verify_application',operationRef:{key:'hirlyApplication.verify',version:'1.0.0'},automationSafe:true},
    {name:'freeze_application',operationRef:{key:'hirlyApplication.freeze',version:'1.0.0'},automationSafe:true},
    {name:'submit_application',operationRef:{key:'hirlyApplication.submit',version:'1.0.0'},requiresApproval:true,automationSafe:false}
  ],maxSteps:5
});
