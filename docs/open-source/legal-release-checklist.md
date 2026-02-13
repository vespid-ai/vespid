# Legal Release Checklist

Use this checklist before every `major` or `minor` community release.

## IP and Provenance
- [ ] No enterprise/proprietary code included in public mirror output.
- [ ] Third-party dependencies are reviewed for license compatibility.
- [ ] Contributor intake for release scope passed CLA checks.

## Licensing
- [ ] SPDX checks passed (`pnpm check:licenses`).
- [ ] Root and package-level license files are present and accurate.
- [ ] Community/enterprise boundary documentation is up to date.

## Trademark
- [ ] Release notes include trademark usage constraints.
- [ ] No unauthorized logo/brand artifacts are included.

## Security and Disclosure
- [ ] Secret scan passed (`pnpm check:secrets`).
- [ ] No internal-only URLs, tokens, or non-public operational details leaked.

## Approval
- [ ] Engineering approver signed off.
- [ ] Legal approver signed off.

## Chinese Summary
- 每次 major/minor 发布前，必须完成知识产权、许可证、商标、密钥泄露四类检查并留存审批记录。
