import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const ROLE_GROUPS = [
  {
    group: "Technology",
    roles: [
      "Software Engineer",
      "Frontend Developer",
      "Backend Developer",
      "Full Stack Developer",
      "Mobile Developer",
      "Data Analyst",
      "Data Scientist",
      "Business Analyst",
      "QA Engineer",
      "DevOps Engineer",
      "IT Support Specialist",
    ],
  },
  {
    group: "Product & Design",
    roles: [
      "Product Manager",
      "Project Manager",
      "Graphic Designer",
      "UX/UI Designer",
      "Product Designer",
      "Content Designer",
      "Researcher",
    ],
  },
  {
    group: "Business",
    roles: [
      "Market Analyst",
      "Marketing Manager",
      "Sales Representative",
      "Customer Support",
      "Operations Manager",
      "HR Assistant",
      "Administrative Assistant",
      "Receptionist",
      "Office Manager",
      "Executive Assistant",
    ],
  },
  {
    group: "Finance",
    roles: [
      "Finance Analyst",
      "Accountant",
      "Bookkeeper",
      "Financial Advisor",
      "Payroll Specialist",
      "Accounts Assistant",
    ],
  },
  {
    group: "Healthcare & Education",
    roles: [
      "Nurse",
      "Teacher",
      "Teaching Assistant",
      "Care Assistant",
      "Medical Receptionist",
      "Pharmacy Assistant",
    ],
  },
  {
    group: "Service & Operations",
    roles: [
      "Waiter",
      "Barista",
      "Warehouse Worker",
      "Driver",
      "Delivery Driver",
      "Retail Assistant",
      "Store Manager",
      "Cleaner",
      "Security Guard",
      "Chef",
      "Kitchen Assistant",
    ],
  },
];

export default function RolePicker({ value, onChange, testId = "role-picker" }) {
  const [query, setQuery] = useState("");
  const [manual, setManual] = useState(false);
  const [open, setOpen] = useState(false);

  const filteredGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ROLE_GROUPS;
    return ROLE_GROUPS
      .map((group) => ({
        ...group,
        roles: group.roles.filter((role) => role.toLowerCase().includes(q)),
      }))
      .filter((group) => group.roles.length > 0);
  }, [query]);

  const selectRole = (role) => {
    setManual(false);
    onChange(role);
    setOpen(false);
  };

  return (
    <div className="space-y-3" data-testid={testId}>
      <div className="space-y-1.5">
        <Label className="text-sm font-semibold text-zinc-200">Target role</Label>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full h-11 rounded-xl bg-sprout-surface-2 border border-sprout-border text-white px-4 flex items-center justify-between text-left"
          data-testid={`${testId}-toggle`}
        >
          <span className={`truncate text-sm ${value ? "text-white" : "text-sprout-dim"}`}>
            {value || "Choose a role"}
          </span>
          <ChevronDown className={`w-4 h-4 text-sprout-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>

      {open && (
        <>
          <div className="space-y-1.5">
            <Label className="text-sm font-semibold text-zinc-200">Search roles</Label>
        <div className="relative">
          <Search className="w-4 h-4 text-sprout-muted absolute left-3 top-3.5" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search common roles"
            className="h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white placeholder:text-sprout-dim pl-10"
            data-testid={`${testId}-search`}
          />
        </div>
      </div>

      <div className="max-h-[42vh] overflow-y-auto rounded-2xl border border-sprout-border bg-sprout-surface divide-y divide-sprout-border">
        {filteredGroups.length === 0 ? (
          <div className="px-4 py-5 text-sm text-sprout-muted">No matching roles. Choose Other below.</div>
        ) : (
          filteredGroups.map((group) => (
            <section key={group.group} className="py-3">
              <h3 className="px-4 pb-2 text-[11px] uppercase tracking-[0.16em] text-sprout-muted">{group.group}</h3>
              <div className="space-y-1">
                {group.roles.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => selectRole(role)}
                    className={`w-full px-4 py-2.5 text-left text-sm font-medium transition-colors ${
                      !manual && value === role
                        ? "bg-sprout-mint-soft text-sprout-mint"
                        : "text-zinc-100 hover:bg-sprout-surface-2"
                    }`}
                    data-testid={`${testId}-role`}
                  >
                    {role}
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
        <button
          type="button"
          onClick={() => {
            setManual(true);
            onChange("");
          }}
          className={`w-full px-4 py-3 text-left text-sm font-semibold ${
            manual ? "bg-sprout-mint-soft text-sprout-mint" : "text-zinc-100 hover:bg-sprout-surface-2"
          }`}
          data-testid={`${testId}-other`}
        >
          Other
        </button>
      </div>

      {manual && (
        <div className="space-y-1.5">
          <Label className="text-sm font-semibold text-zinc-200">Custom role</Label>
          <Input
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Enter your target role"
            className="h-11 rounded-xl bg-sprout-surface-2 border-sprout-border text-white placeholder:text-sprout-dim"
            data-testid={`${testId}-manual`}
          />
        </div>
      )}
        </>
      )}
    </div>
  );
}
