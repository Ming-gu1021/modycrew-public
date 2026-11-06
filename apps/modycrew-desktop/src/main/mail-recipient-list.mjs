const addressPattern = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/u;
const valid = value => typeof value === 'string' && value.length <= 254 && value.split('@')[0].length <= 64 && addressPattern.test(value);
export const MAIL_RECIPIENT_LIMIT = 50;

/** Only mailbox addresses, never display names or MIME headers. Invalid input is rejected, not shortened. */
export function parseMailRecipientList(input = '', label = '참조') {
  const source = Array.isArray(input) ? input : typeof input === 'string' ? input.split(/[,;]/u) : null;
  if (!source || source.length > MAIL_RECIPIENT_LIMIT || source.some(value => typeof value !== 'string' || /[\r\n\u0000-\u001f\u007f]/u.test(value))) throw new Error(`${label}에는 쉼표로 구분한 이메일 주소만 입력해 주세요.`);
  const addresses = source.map(value=>value.trim()).filter(Boolean);
  if (addresses.some(value=>!valid(value))) throw new Error(`${label} 이메일 형식을 확인해 주세요. 이름을 빼고 주소만 입력해 주세요.`);
  return addresses;
}

export function mailRecipientLists(recipient = '', ccInput = '', bccInput = '') {
  const cc = parseMailRecipientList(ccInput, '참조'); const bcc = parseMailRecipientList(bccInput, '숨은참조');
  const recipients = [...(recipient ? [recipient] : []), ...cc, ...bcc];
  if (recipients.length > MAIL_RECIPIENT_LIMIT) throw new Error(`받는 사람·참조·숨은참조는 합계 ${MAIL_RECIPIENT_LIMIT}명까지 가능합니다.`);
  if (new Set(recipients.map(value=>value.toLowerCase())).size !== recipients.length) throw new Error('받는 사람·참조·숨은참조에 중복된 주소가 있습니다. 한 곳에만 남겨 주세요.');
  return { cc, bcc, recipients };
}

export function mailAddressHeader(label, addresses) {
  return addresses.length ? `${label}: ${addresses.map(address=>`<${address}>`).join(',\r\n ')}` : '';
}
