/* @ds-bundle: {"format":4,"namespace":"ParrotfyDesignSystem_ed2cc2","components":[{"name":"Badge","sourcePath":"components/display/Badge.jsx"},{"name":"Card","sourcePath":"components/display/Card.jsx"},{"name":"Tag","sourcePath":"components/display/Tag.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Tooltip","sourcePath":"components/feedback/Tooltip.jsx"},{"name":"Button","sourcePath":"components/forms/Button.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"IconButton","sourcePath":"components/forms/IconButton.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Radio","sourcePath":"components/forms/Radio.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/display/Badge.jsx":"356b6f475573","components/display/Card.jsx":"c78229d1b453","components/display/Tag.jsx":"8377f1c84c9d","components/feedback/Dialog.jsx":"57ef926a0a67","components/feedback/Toast.jsx":"379094832dc3","components/feedback/Tooltip.jsx":"e938693b9bc5","components/forms/Button.jsx":"0f67fd0036b3","components/forms/Checkbox.jsx":"7d3906f1824e","components/forms/IconButton.jsx":"20341edf9a77","components/forms/Input.jsx":"fc5c3686d823","components/forms/Radio.jsx":"fd9e1d453d8a","components/forms/Select.jsx":"497c9595c928","components/forms/Switch.jsx":"cbbfd582aada","components/navigation/Tabs.jsx":"c9c03731c18d"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.ParrotfyDesignSystem_ed2cc2 = window.ParrotfyDesignSystem_ed2cc2 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/display/Badge.jsx
try { (() => {
/** Parrotfy Badge — small status pill. */
function Badge({
  children,
  variant = 'neutral',
  style = {}
}) {
  const variants = {
    neutral: {
      background: 'var(--lavender-pale)',
      color: 'var(--ink)'
    },
    coral: {
      background: 'var(--coral)',
      color: '#fff'
    },
    blue: {
      background: 'var(--blue)',
      color: '#fff'
    },
    success: {
      background: 'var(--success-bg)',
      color: '#127a34'
    },
    error: {
      background: 'var(--error-bg)',
      color: 'var(--error)'
    },
    warning: {
      background: 'var(--warning-bg)',
      color: '#8a6d00'
    }
  };
  const v = variants[variant] || variants.neutral;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 10px',
      borderRadius: 'var(--radius-pill)',
      fontFamily: 'var(--font-sans)',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      lineHeight: 1.4,
      ...v,
      ...style
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Badge.jsx", error: String((e && e.message) || e) }); }

// components/display/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Parrotfy Card — white surface, soft shadow, rounded. */
function Card({
  children,
  padding = 24,
  elevated = true,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: 'var(--surface-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: elevated ? 'var(--shadow-sm)' : 'none',
      padding,
      fontFamily: 'var(--font-sans)',
      color: 'var(--ink)',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Card.jsx", error: String((e && e.message) || e) }); }

// components/display/Tag.jsx
try { (() => {
/** Parrotfy Tag — removable chip / filter token. */
function Tag({
  children,
  onRemove,
  active = false,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: '6px 12px',
      borderRadius: 'var(--radius-pill)',
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      fontWeight: 400,
      letterSpacing: '0.02em',
      background: active ? 'var(--coral)' : 'var(--lavender-pale)',
      color: active ? '#fff' : 'var(--ink)',
      border: active ? '1px solid transparent' : '1px solid var(--border)',
      ...style
    }
  }, children, onRemove && /*#__PURE__*/React.createElement("button", {
    "aria-label": "Quitar",
    onClick: onRemove,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 16,
      height: 16,
      borderRadius: '50%',
      border: 'none',
      cursor: 'pointer',
      background: 'transparent',
      color: 'inherit',
      opacity: 0.7,
      fontSize: 12,
      lineHeight: 1
    }
  }, "\xD7"));
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/display/Tag.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
/** Parrotfy Dialog — centered modal with scrim. */
function Dialog({
  open = false,
  onClose,
  title,
  children,
  footer,
  width = 440
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 1000,
      background: 'rgba(35,35,35,0.45)',
      backdropFilter: 'blur(2px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24
    }
  }, /*#__PURE__*/React.createElement("div", {
    role: "dialog",
    "aria-modal": "true",
    onClick: e => e.stopPropagation(),
    style: {
      width: '100%',
      maxWidth: width,
      background: '#fff',
      borderRadius: 'var(--radius-xl)',
      boxShadow: 'var(--shadow-lg)',
      padding: 28,
      fontFamily: 'var(--font-sans)',
      color: 'var(--ink)'
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 16,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: 0,
      fontSize: 22,
      fontWeight: 500,
      letterSpacing: '0.02em'
    }
  }, title), /*#__PURE__*/React.createElement("button", {
    "aria-label": "Cerrar",
    onClick: onClose,
    style: {
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      fontSize: 20,
      color: 'var(--gray)',
      lineHeight: 1
    }
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      lineHeight: 1.5,
      letterSpacing: '0.02em',
      color: 'var(--ink)'
    }
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end',
      gap: 10,
      marginTop: 24
    }
  }, footer)));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
/** Parrotfy Toast — transient notification with status accent. */
function Toast({
  children,
  variant = 'neutral',
  onClose,
  style = {}
}) {
  const accents = {
    neutral: 'var(--ink)',
    success: 'var(--success)',
    error: 'var(--error)',
    warning: 'var(--warning)',
    coral: 'var(--coral)'
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      minWidth: 260,
      maxWidth: 420,
      padding: '14px 16px',
      background: '#fff',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-md)',
      borderLeft: `4px solid ${accents[variant] || accents.neutral}`,
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      letterSpacing: '0.02em',
      color: 'var(--ink)',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, children), onClose && /*#__PURE__*/React.createElement("button", {
    "aria-label": "Cerrar",
    onClick: onClose,
    style: {
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      fontSize: 16,
      color: 'var(--gray)',
      lineHeight: 1
    }
  }, "\xD7"));
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Tooltip.jsx
try { (() => {
/** Parrotfy Tooltip — dark hover bubble. Wraps its trigger children. */
function Tooltip({
  label,
  children,
  placement = 'top'
}) {
  const [show, setShow] = React.useState(false);
  const pos = {
    top: {
      bottom: '100%',
      left: '50%',
      transform: 'translateX(-50%) translateY(-8px)'
    },
    bottom: {
      top: '100%',
      left: '50%',
      transform: 'translateX(-50%) translateY(8px)'
    },
    left: {
      right: '100%',
      top: '50%',
      transform: 'translateY(-50%) translateX(-8px)'
    },
    right: {
      left: '100%',
      top: '50%',
      transform: 'translateY(-50%) translateX(8px)'
    }
  };
  return /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      display: 'inline-flex'
    },
    onMouseEnter: () => setShow(true),
    onMouseLeave: () => setShow(false),
    onFocus: () => setShow(true),
    onBlur: () => setShow(false)
  }, children, show && /*#__PURE__*/React.createElement("span", {
    role: "tooltip",
    style: {
      position: 'absolute',
      zIndex: 1100,
      whiteSpace: 'nowrap',
      padding: '6px 10px',
      background: 'var(--ink)',
      color: '#fff',
      borderRadius: 8,
      fontFamily: 'var(--font-sans)',
      fontSize: 12,
      letterSpacing: '0.04em',
      boxShadow: 'var(--shadow-sm)',
      pointerEvents: 'none',
      ...pos[placement]
    }
  }, label));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/forms/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Parrotfy Button — pill-shaped, uppercase label.
 * Variants: primary (coral), secondary (blue), gradient, outline, ghost.
 */
function Button({
  children,
  variant = 'primary',
  size = 'md',
  disabled = false,
  full = false,
  iconLeft = null,
  iconRight = null,
  type = 'button',
  onClick,
  style = {},
  ...rest
}) {
  const sizes = {
    sm: {
      padding: '8px 18px',
      fontSize: 10,
      gap: 6
    },
    md: {
      padding: '12px 26px',
      fontSize: 10,
      gap: 8
    },
    lg: {
      padding: '16px 34px',
      fontSize: 12,
      gap: 10
    }
  };
  const variants = {
    primary: {
      background: 'var(--coral)',
      color: '#fff',
      border: '1.5px solid transparent'
    },
    secondary: {
      background: 'var(--blue)',
      color: '#fff',
      border: '1.5px solid transparent'
    },
    gradient: {
      background: 'var(--gradient-brand)',
      color: '#fff',
      border: '1.5px solid transparent'
    },
    outline: {
      background: 'transparent',
      color: 'var(--coral)',
      border: '1.5px solid var(--coral)'
    },
    ghost: {
      background: 'transparent',
      color: 'var(--ink)',
      border: '1.5px solid transparent'
    }
  };
  const s = sizes[size] || sizes.md;
  const v = variants[variant] || variants.primary;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onClick: onClick,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: s.gap,
      padding: s.padding,
      width: full ? '100%' : 'auto',
      fontFamily: 'var(--font-sans)',
      fontWeight: 700,
      fontSize: s.fontSize,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      lineHeight: 1,
      borderRadius: 'var(--radius-pill)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      transition: 'filter var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
      ...v,
      ...style
    },
    onMouseDown: e => {
      if (!disabled) e.currentTarget.style.transform = 'scale(0.97)';
    },
    onMouseUp: e => {
      e.currentTarget.style.transform = 'scale(1)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.transform = 'scale(1)';
      e.currentTarget.style.filter = 'none';
    },
    onMouseEnter: e => {
      if (!disabled) e.currentTarget.style.filter = 'brightness(0.94)';
    }
  }, rest), iconLeft, children, iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Button.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
/** Parrotfy Checkbox — coral filled when checked. */
function Checkbox({
  label,
  checked = false,
  onChange,
  disabled = false,
  id,
  style = {}
}) {
  const cbId = id || React.useId();
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: cbId,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      letterSpacing: '0.02em',
      color: 'var(--ink)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("input", {
    id: cbId,
    type: "checkbox",
    checked: checked,
    onChange: onChange,
    disabled: disabled,
    style: {
      position: 'absolute',
      opacity: 0,
      width: 1,
      height: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 20,
      height: 20,
      flexShrink: 0,
      borderRadius: 6,
      border: checked ? '1.5px solid var(--coral)' : '1.5px solid var(--border-strong)',
      background: checked ? 'var(--coral)' : '#fff',
      color: '#fff',
      transition: 'all var(--dur-fast) var(--ease-out)'
    }
  }, checked && /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 12 12",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2.5 6.2l2.3 2.3L9.5 3.5",
    stroke: "#fff",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }))), label);
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Parrotfy IconButton — circular icon-only button.
 * Pass a Lucide (or any) icon node as children.
 */
function IconButton({
  children,
  variant = 'ghost',
  size = 'md',
  disabled = false,
  'aria-label': ariaLabel = 'button',
  onClick,
  style = {},
  ...rest
}) {
  const sizes = {
    sm: 32,
    md: 40,
    lg: 48
  };
  const variants = {
    primary: {
      background: 'var(--coral)',
      color: '#fff'
    },
    secondary: {
      background: 'var(--blue)',
      color: '#fff'
    },
    soft: {
      background: 'var(--lavender-pale)',
      color: 'var(--ink)'
    },
    ghost: {
      background: 'transparent',
      color: 'var(--ink)'
    }
  };
  const dim = sizes[size] || sizes.md;
  const v = variants[variant] || variants.ghost;
  return /*#__PURE__*/React.createElement("button", _extends({
    "aria-label": ariaLabel,
    disabled: disabled,
    onClick: onClick,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: dim,
      height: dim,
      borderRadius: 'var(--radius-pill)',
      border: 'none',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.4 : 1,
      transition: 'filter var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out)',
      ...v,
      ...style
    },
    onMouseEnter: e => {
      if (!disabled && variant === 'ghost') e.currentTarget.style.background = 'var(--lavender-pale)';else if (!disabled) e.currentTarget.style.filter = 'brightness(0.94)';
    },
    onMouseLeave: e => {
      e.currentTarget.style.background = v.background;
      e.currentTarget.style.filter = 'none';
    }
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Parrotfy Input — labelled text field with focus ring and optional error.
 */
function Input({
  label,
  value,
  onChange,
  placeholder = '',
  type = 'text',
  error = '',
  hint = '',
  disabled = false,
  iconLeft = null,
  id,
  style = {},
  ...rest
}) {
  const [focused, setFocused] = React.useState(false);
  const inputId = id || React.useId();
  const borderColor = error ? 'var(--error)' : focused ? 'var(--blue)' : 'var(--border)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      fontFamily: 'var(--font-sans)',
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: inputId,
    style: {
      fontSize: 14,
      fontWeight: 500,
      letterSpacing: '0.04em',
      color: 'var(--ink)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '11px 14px',
      background: disabled ? 'var(--lavender-pale)' : '#fff',
      border: `1.5px solid ${borderColor}`,
      borderRadius: 'var(--radius-md)',
      boxShadow: focused && !error ? '0 0 0 3px rgba(39,67,177,0.14)' : 'none',
      transition: 'border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)'
    }
  }, iconLeft && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--gray)',
      display: 'inline-flex'
    }
  }, iconLeft), /*#__PURE__*/React.createElement("input", _extends({
    id: inputId,
    type: type,
    value: value,
    onChange: onChange,
    placeholder: placeholder,
    disabled: disabled,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    style: {
      flex: 1,
      border: 'none',
      outline: 'none',
      background: 'transparent',
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      color: 'var(--ink)',
      letterSpacing: '0.02em'
    }
  }, rest))), error ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--error)',
      letterSpacing: '0.04em'
    }
  }, error) : hint ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--gray)',
      letterSpacing: '0.04em'
    }
  }, hint) : null);
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Radio.jsx
try { (() => {
/** Parrotfy Radio — single option in a group. Coral dot when selected. */
function Radio({
  label,
  checked = false,
  onChange,
  name,
  value,
  disabled = false,
  id,
  style = {}
}) {
  const rId = id || React.useId();
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: rId,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      letterSpacing: '0.02em',
      color: 'var(--ink)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("input", {
    id: rId,
    type: "radio",
    name: name,
    value: value,
    checked: checked,
    onChange: onChange,
    disabled: disabled,
    style: {
      position: 'absolute',
      opacity: 0,
      width: 1,
      height: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 20,
      height: 20,
      flexShrink: 0,
      borderRadius: '50%',
      border: checked ? '1.5px solid var(--coral)' : '1.5px solid var(--border-strong)',
      background: '#fff',
      transition: 'all var(--dur-fast) var(--ease-out)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 10,
      height: 10,
      borderRadius: '50%',
      background: 'var(--coral)',
      transform: checked ? 'scale(1)' : 'scale(0)',
      transition: 'transform var(--dur-fast) var(--ease-out)'
    }
  })), label);
}
Object.assign(__ds_scope, { Radio });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Radio.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Parrotfy Select — styled native dropdown. */
function Select({
  label,
  value,
  onChange,
  options = [],
  placeholder = 'Selecciona…',
  disabled = false,
  id,
  style = {},
  ...rest
}) {
  const selectId = id || React.useId();
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      fontFamily: 'var(--font-sans)',
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("label", {
    htmlFor: selectId,
    style: {
      fontSize: 14,
      fontWeight: 500,
      letterSpacing: '0.04em',
      color: 'var(--ink)'
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative'
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    id: selectId,
    value: value,
    onChange: onChange,
    disabled: disabled,
    style: {
      width: '100%',
      appearance: 'none',
      WebkitAppearance: 'none',
      padding: '11px 40px 11px 14px',
      background: disabled ? 'var(--lavender-pale)' : '#fff',
      border: '1.5px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      color: value ? 'var(--ink)' : 'var(--gray)',
      letterSpacing: '0.02em',
      cursor: disabled ? 'not-allowed' : 'pointer',
      outline: 'none'
    },
    onFocus: e => {
      e.currentTarget.style.borderColor = 'var(--blue)';
      e.currentTarget.style.boxShadow = '0 0 0 3px rgba(39,67,177,0.14)';
    },
    onBlur: e => {
      e.currentTarget.style.borderColor = 'var(--border)';
      e.currentTarget.style.boxShadow = 'none';
    }
  }, rest), placeholder && /*#__PURE__*/React.createElement("option", {
    value: "",
    disabled: true
  }, placeholder), options.map(o => {
    const val = typeof o === 'string' ? o : o.value;
    const lbl = typeof o === 'string' ? o : o.label;
    return /*#__PURE__*/React.createElement("option", {
      key: val,
      value: val
    }, lbl);
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: 14,
      top: '50%',
      transform: 'translateY(-50%)',
      pointerEvents: 'none',
      color: 'var(--gray)',
      fontSize: 12
    }
  }, "\u25BE")));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
/** Parrotfy Switch — pill toggle, gradient track when on. */
function Switch({
  label,
  checked = false,
  onChange,
  disabled = false,
  id,
  style = {}
}) {
  const sId = id || React.useId();
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: sId,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 12,
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      letterSpacing: '0.02em',
      color: 'var(--ink)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("input", {
    id: sId,
    type: "checkbox",
    role: "switch",
    checked: checked,
    onChange: onChange,
    disabled: disabled,
    style: {
      position: 'absolute',
      opacity: 0,
      width: 1,
      height: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'relative',
      width: 44,
      height: 26,
      flexShrink: 0,
      borderRadius: 'var(--radius-pill)',
      background: checked ? 'var(--gradient-brand)' : 'var(--gray-light)',
      transition: 'background var(--dur-base) var(--ease-out)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 3,
      left: 3,
      width: 20,
      height: 20,
      borderRadius: '50%',
      background: '#fff',
      boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
      transform: checked ? 'translateX(18px)' : 'translateX(0)',
      transition: 'transform var(--dur-base) var(--ease-out)'
    }
  })), label);
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
/** Parrotfy Tabs — underline style with coral active indicator. */
function Tabs({
  tabs = [],
  value,
  onChange,
  style = {}
}) {
  const items = tabs.map(t => typeof t === 'string' ? {
    value: t,
    label: t
  } : t);
  const active = value ?? items[0]?.value;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 4,
      borderBottom: '1.5px solid var(--border)',
      fontFamily: 'var(--font-sans)',
      ...style
    }
  }, items.map(t => {
    const on = t.value === active;
    return /*#__PURE__*/React.createElement("button", {
      key: t.value,
      onClick: () => onChange && onChange(t.value),
      style: {
        position: 'relative',
        padding: '12px 18px',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
        fontSize: 14,
        fontWeight: on ? 500 : 400,
        letterSpacing: '0.02em',
        color: on ? 'var(--ink)' : 'var(--gray)',
        transition: 'color var(--dur-fast) var(--ease-out)'
      }
    }, t.label, /*#__PURE__*/React.createElement("span", {
      style: {
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: -1.5,
        height: 3,
        borderRadius: 3,
        background: 'var(--coral)',
        transform: on ? 'scaleX(1)' : 'scaleX(0)',
        transition: 'transform var(--dur-base) var(--ease-out)'
      }
    }));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Tooltip = __ds_scope.Tooltip;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Radio = __ds_scope.Radio;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Tabs = __ds_scope.Tabs;

})();
