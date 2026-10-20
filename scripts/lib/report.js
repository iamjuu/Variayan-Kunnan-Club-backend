export function printImportReport(report) {
  if (!report.files.length) {
    console.log('⚠ No dataset files found. Place the Keralotsavam JSON files in server/data/keralotsavam/ and re-run.');
    return;
  }
  console.log(`\n${report.dryRun ? 'DRY RUN – nothing written. ' : ''}Import summary`);
  console.log(`  Created:            ${report.created}`);
  console.log(`  Updated:            ${report.updated}`);
  console.log(`  Already present:    ${report.skippedExisting}`);
  console.log(`  Duplicates in JSON: ${report.duplicatesInSource}`);
  for (const f of report.files) {
    if (f.emptyCategories.length) {
      console.log(`  ${f.fileName}: ${f.emptyCategories.length} categor(ies) with empty event arrays (valid): ${f.emptyCategories.join(', ')}`);
    }
  }
  if (report.warnings.length) {
    console.log(`\n⚠ ${report.warnings.length} warning(s) – review these items in the admin panel:`);
    report.warnings.slice(0, 50).forEach((w) => console.log(`  - ${w}`));
    if (report.warnings.length > 50) console.log(`  … and ${report.warnings.length - 50} more`);
  }
}
