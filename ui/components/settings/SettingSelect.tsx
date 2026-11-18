import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SettingSelect<Value extends string>({
  label,
  id,
  value,
  choices,
  orientation = "vertical",
  disabled,
  change,
}: {
  label: string;
  id: string;
  value: Value;
  choices: Value[];
  orientation?: "vertical" | "responsive";
  disabled: boolean;
  change: (value: Value) => void;
}) {
  return (
    <Field orientation={orientation} data-disabled={disabled}>
      <FieldLabel id={`${id}-label`} htmlFor={id}>
        {label}
      </FieldLabel>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next !== null) change(next);
        }}
      >
        <SelectTrigger
          id={id}
          aria-labelledby={`${id}-label`}
          className={orientation === "responsive" ? "w-full @sm/field-group:w-48" : "w-full"}
        >
          <SelectValue className="min-w-0">
            <span className="truncate">{value}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {choices.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  );
}
