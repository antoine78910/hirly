# Application Agent Runtime

Local, provider-neutral runtime for the Evidence-Backed Application Agent contracts.

It is fixture/simulator-only. It has no network client, browser automation, production ATS adapter, credentials, or HTTP listener. `submit` is enforced by the ContractSpec operation registry before the handler runs and is only executable against the controlled simulator after an exact, one-time approval receipt.
