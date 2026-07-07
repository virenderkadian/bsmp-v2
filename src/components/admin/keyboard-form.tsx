"use client";

import type { FormHTMLAttributes, KeyboardEvent } from "react";

function getFocusableElements(form: HTMLFormElement) {
  return Array.from(
    form.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])',
    ),
  ).filter((element) => {
    if (element instanceof HTMLButtonElement && element.type === "button") {
      return false;
    }

    return !element.hasAttribute("data-skip-enter-nav");
  });
}

export function KeyboardForm(props: FormHTMLAttributes<HTMLFormElement>) {
  const handleKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    props.onKeyDown?.(event);

    if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey) {
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target instanceof HTMLTextAreaElement) {
      return;
    }

    const form = event.currentTarget;
    const focusable = getFocusableElements(form);
    const currentIndex = focusable.indexOf(target);

    if (currentIndex === -1) {
      return;
    }

    const nextFocusable = focusable[currentIndex + 1];
    if (nextFocusable) {
      event.preventDefault();
      nextFocusable.focus();
      if (
        nextFocusable instanceof HTMLInputElement &&
        ["text", "number", "search", "tel", "email", "url"].includes(nextFocusable.type)
      ) {
        nextFocusable.select();
      }
    }
  };

  return <form {...props} onKeyDown={handleKeyDown} />;
}
