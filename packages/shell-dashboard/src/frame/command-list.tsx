import { Command, CommandItem } from '@agentage/design-system/command';
import type { Command as Cmd } from './frame.types.js';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Cmd[];
}

// Ctrl+K: one line per app row plus the frame commands (K13); app commands come later.
export const CommandList = ({ open, onOpenChange, commands }: Props) => (
  <Command
    open={open}
    onOpenChange={onOpenChange}
    placeholder="Type a command"
    dialogLabel="Command list"
    aria-label="Command"
  >
    {commands.map((c) => (
      <CommandItem
        key={c.id}
        icon={c.icon}
        onClick={() => {
          onOpenChange(false);
          c.run();
        }}
      >
        {c.label}
      </CommandItem>
    ))}
  </Command>
);
