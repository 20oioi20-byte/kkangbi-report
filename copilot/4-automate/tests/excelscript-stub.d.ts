// 시험용 최소 타입 — 스크립트가 쓰는 ExcelScript API 만 선언한다(실제 Excel 에서는 진짜 타입이 쓰인다).
declare namespace ExcelScript {
  interface Range {
    getValues(): (string | number | boolean)[][];
    getRowIndex(): number;
    getColumnIndex(): number;
    getRowCount(): number;
    getColumnCount(): number;
    getMergedAreasOrNullObject(): RangeAreas;
  }
  interface RangeAreas {
    getAreas(): Range[];
  }
  interface Worksheet {
    getName(): string;
    getUsedRange(valuesOnly?: boolean): Range;
  }
  interface Workbook {
    getWorksheets(): Worksheet[];
    getWorksheet(name: string): Worksheet | undefined;
  }
}
