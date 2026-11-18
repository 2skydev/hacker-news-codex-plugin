import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SettingSelect<Value extends string>({
  label,
  id,
  value,
  choices,
  disabled,
  change,
}: {
  label: string;
  id: string;
  value: Value;
  choices: Value[];
  disabled: boolean;
  change: (value: Value) => void;
}) {
  return (
    <div className="setting-row">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next !== null) change(next);
        }}
      >
        <SelectTrigger id={id} aria-labelledby={`${id}-label`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
