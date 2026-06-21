import { Card, CardContent, CardFooter } from "../ui/card";

export default function ProfileFormSection({ title, description, children, footer }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-8">
      <div className="shrink-0 lg:w-1/3">
        <h2 className="shell-title mb-2 text-lg font-semibold">{title}</h2>
        <p className="text-sm shell-body">{description}</p>
      </div>
      <div className="min-w-0 lg:w-2/3">
        <Card className="gap-6 py-6 shadow-sm">
          <CardContent className="px-6">{children}</CardContent>
          {footer ? <CardFooter className="px-6">{footer}</CardFooter> : null}
        </Card>
      </div>
    </div>
  );
}
