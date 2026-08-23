# Fontes embutidas (card de destaque)

Usadas pelo `card-renderer` para renderizar o PNG do destaque do mês de forma
determinística (sem depender das fontes do sistema).

| Arquivo | Família | Uso |
| --- | --- | --- |
| `Montserrat-Regular.ttf` / `Montserrat-Bold.ttf` / `Montserrat-ExtraBold.ttf` | Montserrat | Título, tags, nome e texto |
| `DancingScript.ttf` | Dancing Script | Nome do mês (cursiva) |

Ambas as famílias são distribuídas sob a **SIL Open Font License 1.1**
(redistribuição e embarque permitidos). Fonte: Google Fonts
(github.com/google/fonts). As variações estáticas de Montserrat foram geradas a
partir da fonte variável com `fonttools varLib.instancer`.
