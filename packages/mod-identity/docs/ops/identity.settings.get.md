Read the effective signup policy (`"open"` or `"invite"`): the runtime setting
(the construction-time mod option only seeds it), so it reflects whatever was
last toggled. Pairs with `identity.settings.set`; backs the admin Settings
section. Privileged: gate the trigger with the `admin` scope.
