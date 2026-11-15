/**
 * Safe Financial Number Parser and Validator
 * 
 * Accurately parses Turkish locale numbers (e.g. 1.234,56 or 1234,56)
 * and standard dot-decimal numbers (e.g. 1234.56), while strictly rejecting
 * invalid, infinite, negative, or ambiguous inputs.
 */

export interface ParseFinancialNumberOptions {
  allowZero?: boolean;
  allowNegative?: boolean;
  maxDecimals?: number;
  min?: number;
  max?: number;
}

export interface FinancialParseResult {
  isValid: boolean;
  value: number | null;
  errorMessage?: string;
}

/**
 * Normalizes and validates user numeric input strings into safe JavaScript numbers.
 */
export function parseFinancialNumber(
  rawInput: string | number | null | undefined,
  options: ParseFinancialNumberOptions = {}
): FinancialParseResult {
  const {
    allowZero = false,
    allowNegative = false,
    maxDecimals,
    min,
    max,
  } = options;

  if (rawInput === null || rawInput === undefined) {
    return { isValid: false, value: null, errorMessage: 'Lütfen geçerli bir sayı girin.' };
  }

  const inputStr = typeof rawInput === 'number' ? String(rawInput) : String(rawInput).trim();

  if (!inputStr) {
    return { isValid: false, value: null, errorMessage: 'Değer boş bırakılamaz.' };
  }

  // Reject scientific notation (e.g. 1e5, 2E-3)
  if (/[eE]/.test(inputStr)) {
    return { isValid: false, value: null, errorMessage: 'Bilimsel gösterim desteklenmemektedir.' };
  }

  // Reject multiple sign characters or invalid character sets
  if (/^[-+]{2,}/.test(inputStr) || /[^\d.,\s+-]/.test(inputStr)) {
    return { isValid: false, value: null, errorMessage: 'Yalnızca rakam ve ondalık ayırıcı giriniz.' };
  }

  // Remove spaces
  const cleanStr = inputStr.replace(/\s+/g, '');

  // Detect negative sign
  const isNegative = cleanStr.startsWith('-');
  const unsignedStr = cleanStr.replace(/^[-+]/, '');

  if (!unsignedStr) {
    return { isValid: false, value: null, errorMessage: 'Lütfen geçerli bir sayı girin.' };
  }

  if (isNegative && !allowNegative) {
    return { isValid: false, value: null, errorMessage: 'Pozitif bir değer girmelisiniz.' };
  }

  // Count dots and commas
  const dotCount = (unsignedStr.match(/\./g) || []).length;
  const commaCount = (unsignedStr.match(/,/g) || []).length;

  let normalized = '';

  if (dotCount > 0 && commaCount > 0) {
    // Mixed usage:
    // e.g. "1.234,56" (Turkish format: dots as thousands, comma as decimal)
    // or "1,234.56" (US format: commas as thousands, dot as decimal)
    const lastDotIndex = unsignedStr.lastIndexOf('.');
    const lastCommaIndex = unsignedStr.lastIndexOf(',');

    if (lastCommaIndex > lastDotIndex) {
      // Turkish format: "1.234.567,89" -> remove dots, replace comma with dot
      if (commaCount > 1) {
        return { isValid: false, value: null, errorMessage: 'Birden fazla ondalık virgülü girilemez.' };
      }
      normalized = unsignedStr.replace(/\./g, '').replace(',', '.');
    } else {
      // US format: "1,234,567.89" -> remove commas, keep dot
      if (dotCount > 1) {
        return { isValid: false, value: null, errorMessage: 'Birden fazla ondalık noktası girilemez.' };
      }
      normalized = unsignedStr.replace(/,/g, '');
    }
  } else if (commaCount === 1 && dotCount === 0) {
    // Turkish decimal: "1234,56" -> "1234.56"
    normalized = unsignedStr.replace(',', '.');
  } else if (dotCount === 1 && commaCount === 0) {
    // Standard decimal: "1234.56" -> "1234.56"
    normalized = unsignedStr;
  } else if (commaCount > 1 && dotCount === 0) {
    // Invalid multiple commas: "1,2,3" or thousands without dot "1,000,000"
    if (/^\d{1,3}(,\d{3})+$/.test(unsignedStr)) {
      normalized = unsignedStr.replace(/,/g, '');
    } else {
      return { isValid: false, value: null, errorMessage: 'Geçersiz sayı biçimi.' };
    }
  } else if (dotCount > 1 && commaCount === 0) {
    // Thousands dots without decimal: e.g. "1.000.000"
    if (/^\d{1,3}(\.\d{3})+$/.test(unsignedStr)) {
      normalized = unsignedStr.replace(/\./g, '');
    } else {
      return { isValid: false, value: null, errorMessage: 'Geçersiz sayı biçimi.' };
    }
  } else if (dotCount === 0 && commaCount === 0) {
    // Pure integer
    normalized = unsignedStr;
  } else {
    return { isValid: false, value: null, errorMessage: 'Geçersiz sayı biçimi.' };
  }

  // Ensure normalized string matches standard decimal number regex
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return { isValid: false, value: null, errorMessage: 'Geçersiz sayı biçimi.' };
  }

  // Check decimal places
  if (maxDecimals !== undefined) {
    const parts = normalized.split('.');
    if (parts.length === 2 && parts[1].length > maxDecimals) {
      return {
        isValid: false,
        value: null,
        errorMessage: `En fazla ${maxDecimals} ondalık basamak girebilirsiniz.`,
      };
    }
  }

  let finalNumber = Number(normalized);
  if (isNegative) {
    finalNumber = -finalNumber;
  }

  // Check NaN and finite
  if (isNaN(finalNumber) || !isFinite(finalNumber)) {
    return { isValid: false, value: null, errorMessage: 'Geçersiz veya tanımsız sayı.' };
  }

  // Check zero rule
  if (!allowZero && finalNumber === 0) {
    return { isValid: false, value: null, errorMessage: 'Değer sıfırdan büyük olmalıdır.' };
  }

  // Check min constraint
  if (min !== undefined && finalNumber < min) {
    return {
      isValid: false,
      value: null,
      errorMessage: `Değer en az ${min} olmalıdır.`,
    };
  }

  // Check max constraint
  if (max !== undefined && finalNumber > max) {
    return {
      isValid: false,
      value: null,
      errorMessage: `Değer en fazla ${max} olabilir.`,
    };
  }

  return {
    isValid: true,
    value: finalNumber,
  };
}

/**
 * Calculates total trade transaction cost safely: quantity * price.
 * Returns null if either input is invalid.
 */
export function calculateTradeTotal(
  quantityInput: string | number,
  priceInput: string | number,
  quantityOptions: ParseFinancialNumberOptions = { allowZero: false, allowNegative: false },
  priceOptions: ParseFinancialNumberOptions = { allowZero: false, allowNegative: false }
): { isValid: boolean; total: number | null; quantity: number | null; price: number | null; error?: string } {
  const qtyParsed = parseFinancialNumber(quantityInput, quantityOptions);
  if (!qtyParsed.isValid || qtyParsed.value === null) {
    return {
      isValid: false,
      total: null,
      quantity: null,
      price: null,
      error: qtyParsed.errorMessage || 'Geçersiz miktar',
    };
  }

  const priceParsed = parseFinancialNumber(priceInput, priceOptions);
  if (!priceParsed.isValid || priceParsed.value === null) {
    return {
      isValid: false,
      total: null,
      quantity: qtyParsed.value,
      price: null,
      error: priceParsed.errorMessage || 'Geçersiz fiyat',
    };
  }

  const total = Number((qtyParsed.value * priceParsed.value).toFixed(4));
  return {
    isValid: true,
    total,
    quantity: qtyParsed.value,
    price: priceParsed.value,
  };
}
