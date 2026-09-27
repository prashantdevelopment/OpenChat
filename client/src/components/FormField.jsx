import { useState } from "react";
import { CircleAlertIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

// A labelled form control with an optional hint and error. The control is
// passed as a function, so it gets the props that connect it to the label and
// messages: screen readers read the hint and the error with the field, and
// aria-invalid marks it red (see index.css).
//   <FormField id="email" label="Email" error={errors.email}>
//     {(props) => <input {...props} type="email" />}
//   </FormField>
const FormField = ({ id, label, hint, error, children }) => {
  const hintId = hint ? `${id}-hint` : null;
  const errorId = error ? `${id}-error` : null;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block font-mono text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="flex items-start gap-1.5 text-sm text-destructive-foreground">
          <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}
    </div>
  );
};

// Password box with a button to show what was typed (fewer typos on phones).
export const PasswordInput = (props) => {
  const [isVisible, setIsVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={isVisible ? "text" : "password"} className="field pr-12" />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-1/2 right-0 size-11 -translate-y-1/2 rounded-full text-muted-foreground sm:size-11"
        aria-label="Show password"
        aria-pressed={isVisible}
        onClick={() => setIsVisible((visible) => !visible)}
      >
        {isVisible ? <EyeOffIcon aria-hidden="true" strokeWidth={1.4} /> : <EyeIcon aria-hidden="true" strokeWidth={1.4} />}
      </Button>
    </div>
  );
};

export default FormField;
