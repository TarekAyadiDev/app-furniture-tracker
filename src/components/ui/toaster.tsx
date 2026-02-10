import { useToast } from "@/hooks/use-toast";
import { createPortal } from "react-dom";
import { Toast, ToastAction, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";

export function Toaster() {
  const { toasts } = useToast();

  const content = (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        const text =
          typeof description === "string"
            ? description
            : typeof title === "string"
              ? title
              : null;
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            <div className="flex items-center gap-2">
              {text ? (
                <ToastAction
                  altText="Copy toast message"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(text);
                    } catch {
                      // no-op
                    }
                  }}
                >
                  Copy
                </ToastAction>
              ) : null}
              {action}
            </div>
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );

  if (typeof document === "undefined") return content;
  return createPortal(content, document.body);
}
