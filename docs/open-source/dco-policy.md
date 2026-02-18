# DCO Policy

## Purpose
Vespid uses DCO (Developer Certificate of Origin) as the required contribution sign-off process.

## Requirements
- Every commit in a pull request must include a `Signed-off-by` trailer.
- Contributors should use `git commit -s`.

Required format:

```text
Signed-off-by: Your Name <you@example.com>
```

## CI Enforcement
- GitHub workflow: `.github/workflows/dco.yml`
- Pull requests fail if any commit is missing a valid sign-off trailer.

## Why DCO
- Keeps contribution attestation lightweight and auditable.
- Matches open-source contribution norms for Apache-licensed projects.

## Summary
DCO sign-off is mandatory for all code contributions.
