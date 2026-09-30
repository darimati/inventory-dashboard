-- v8: inf_campaigns에 channel 컬럼 추가
-- Supabase Dashboard > SQL Editor에서 실행할 것

-- 1. 컬럼 추가
ALTER TABLE inf_campaigns ADD COLUMN IF NOT EXISTS channel text;

-- 2. 기존 데이터 변환: 괄호 안 값을 channel로 이동
UPDATE inf_campaigns SET channel = '스레드'
WHERE name LIKE '%(스레드)%' AND (channel IS NULL OR channel = '');

-- 3. 나머지 캠페인: 기본값 '인스타'
UPDATE inf_campaigns SET channel = '인스타'
WHERE channel IS NULL OR channel = '';
