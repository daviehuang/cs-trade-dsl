;; Unified Business Rule DSL -- decimal kernel (single source -> one kernel.wasm)
;; Route B: this ONE .wasm runs in Node (UI/BFF) AND in JVM (middle-platform via Chicory).
;; Decimal is represented as scaled-int: value = unscaled / 10^6 (fixed scale 6).
;; All integer math -> no IEEE float, so no drift.
(module
  ;; round_half_up(num / den), den>0, sign-correct (away from zero)
  (func $divHalfUp (param $num i64) (param $den i64) (result i64)
    (local $sign i64) (local $n i64)
    (local.set $sign (i64.const 1))
    (local.set $n (local.get $num))
    (if (i64.lt_s (local.get $num) (i64.const 0))
      (then
        (local.set $sign (i64.const -1))
        (local.set $n (i64.sub (i64.const 0) (local.get $num)))))
    ;; q = (n*2 + den) / (den*2)  -- integer div rounding 0.5 up
    (i64.mul
      (local.get $sign)
      (i64.div_u
        (i64.add (i64.mul (local.get $n) (i64.const 2)) (local.get $den))
        (i64.mul (local.get $den) (i64.const 2)))))

  ;; 10^e
  (func $pow10 (param $e i32) (result i64)
    (local $r i64) (local $i i32)
    (local.set $r (i64.const 1))
    (local.set $i (i32.const 0))
    (block $brk (loop $lp
      (br_if $brk (i32.ge_s (local.get $i) (local.get $e)))
      (local.set $r (i64.mul (local.get $r) (i64.const 10)))
      (local.set $i (i32.add (local.get $i) (i32.const 1)))
      (br $lp)))
    (local.get $r))

  ;; add / sub (same scale, exact)
  (func (export "dadd") (param $a i64) (param $b i64) (result i64)
    (i64.add (local.get $a) (local.get $b)))
  (func (export "dsub") (param $a i64) (param $b i64) (result i64)
    (i64.sub (local.get $a) (local.get $b)))

  ;; mul: round_half_up(a*b / 10^6)
  (func (export "dmul") (param $a i64) (param $b i64) (result i64)
    (call $divHalfUp (i64.mul (local.get $a) (local.get $b)) (i64.const 1000000)))

  ;; div: round_half_up(a*10^6 / b), normalize denominator positive
  (func (export "ddiv") (param $a i64) (param $b i64) (result i64)
    (local $num i64) (local $den i64)
    (local.set $num (i64.mul (local.get $a) (i64.const 1000000)))
    (local.set $den (local.get $b))
    (if (i64.lt_s (local.get $den) (i64.const 0))
      (then
        (local.set $num (i64.sub (i64.const 0) (local.get $num)))
        (local.set $den (i64.sub (i64.const 0) (local.get $den)))))
    (call $divHalfUp (local.get $num) (local.get $den)))

  ;; round to n decimal places (result still scaled-6), HALF_UP
  (func (export "dround") (param $a i64) (param $n i32) (result i64)
    (local $factor i64)
    (local.set $factor (call $pow10 (i32.sub (i32.const 6) (local.get $n))))
    (i64.mul (call $divHalfUp (local.get $a) (local.get $factor)) (local.get $factor)))
)
