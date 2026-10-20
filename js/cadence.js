/* ============ CADENCE — funil de follow-ups estruturado ============
   Cadências desenhadas a partir de:
   - Lead Response Management Study (InsideSales/MIT): responder em até
     5 minutos aumenta em até 21x a chance de qualificar o lead.
   - IRC Sales Solutions: 80% das vendas exigem 5+ follow-ups, mas 44%
     dos vendedores desistem após o 1º contato.
   - Prospecção Fanática (Jeb Blount): sequências multi-toque e
     mensagem de "breakup" para gerar resposta por aversão à perda.
==================================================================== */

const Cadence = (() => {

  function defaults() {
    /* v2 (jurídico) — mensagens 100% prontas: os tokens {{caso}}, {{pergunta}},
       {{dica}}, {{urgencia}} e {{beneficio}} se adaptam sozinhos à ÁREA do lead
       (família, imobiliário, trabalhista...). Tom sóbrio, sem promessa de
       resultado, alinhado ao Código de Ética da OAB. */
    return [
      {
        id: 'speed-to-lead',
        nome: 'Lead Novo — Primeiro Contato',
        cenario: 'Lead que acabou de chegar ou ainda não respondeu',
        ref: 'Speed-to-lead + Prospecção Fanática (Blount) + SPIN (situação)',
        passos: [
          { dia: 0, canal: 'WhatsApp', titulo: 'Resposta imediata', objetivo: 'Falar na janela de ouro dos primeiros minutos + abrir com pergunta de situação (SPIN)', template: 'Olá, {{nome}}! Aqui é {{atendente}}, do {{empresa}}.\n\nRecebi o seu contato sobre {{caso}} e quero entender direito a sua situação para te orientar da melhor forma.\n\nPara começar: {{pergunta}}?' },
          { dia: 0, canal: 'WhatsApp', titulo: 'Reforço no mesmo dia', objetivo: 'Segundo toque em outro horário, com rótulo de empatia (Voss)', template: '{{nome}}, sei que o dia corre — sem pressa.\n\nQuando conseguir me responder, sigo daqui com a sua orientação. Se preferir conversar por ligação, me diga o melhor horário que eu ligo.' },
          { dia: 1, canal: 'Ligação', titulo: 'Tentativa de ligação', objetivo: 'Canal diferente aumenta a taxa de contato (Blount)', template: '(Ligar primeiro. Se não atender, enviar:)\n\n{{nome}}, acabei de tentar te ligar para falarmos sobre {{caso}}.\n\nPor mensagem também funciona: me conta por aqui, ou me diga um horário bom para eu ligar de novo.' },
          { dia: 3, canal: 'WhatsApp', titulo: 'Orientação de valor', objetivo: 'Entregar valor sem pedir nada em troca (reciprocidade — Cialdini)', template: '{{nome}}, uma orientação que vale desde já, independente de contratar qualquer coisa:\n\n{{dica}}.\n\nSe quiser, a partir daí eu te explico o caminho completo para {{beneficio}}.' },
          { dia: 7, canal: 'WhatsApp', titulo: 'Pergunta direta', objetivo: 'Reabrir com pergunta de resposta fácil (baixo atrito)', template: '{{nome}}, {{caso}} ainda está nos seus planos?\n\nUm "sim" ou "ainda não" já me ajuda a te atender do jeito certo — sem te encher de mensagens.' },
          { dia: 14, canal: 'WhatsApp', titulo: 'Pergunta orientada ao "não"', objetivo: 'O "não" destrava resposta em quem sumiu (Chris Voss)', template: '{{nome}}, você desistiu de resolver {{caso}}?\n\nSe ainda pretende, me avisa que retomo de onde paramos — lembrando que {{urgencia}}.\n\nSe não for o momento, tudo bem também: só me confirma para eu não te incomodar.' },
          { dia: 30, canal: 'WhatsApp', titulo: 'Encerramento respeitoso (breakup)', objetivo: 'Aversão à perda: encerrar gera resposta em quem tinha interesse real', template: '{{nome}}, como não consegui retorno, vou encerrar o seu atendimento por aqui para não te incomodar mais.\n\nFica um cuidado final, de coração: {{urgencia}}. Se decidir cuidar disso, este número estará à disposição — será um prazer te atender.' }
        ]
      },
      {
        id: 'qualificacao',
        nome: 'Qualificação — Retomar a Conversa',
        cenario: 'Lead respondeu e a conversa sobre o caso parou no meio',
        ref: 'SPIN (investigação) + Voss (rótulo de empatia + no-oriented)',
        passos: [
          { dia: 0, hora: 'agora+3h', canal: 'WhatsApp', titulo: 'Retomada no mesmo dia', objetivo: 'Rótulo de empatia + repetir a pergunta onde a conversa parou', template: '{{nome}}, percebi que nossa conversa sobre {{caso}} ficou pela metade — imagino que o seu dia tenha apertado.\n\nQuando conseguir, seguimos de onde paramos: {{pergunta}}?' },
          { dia: 1, canal: 'WhatsApp', titulo: 'Orientação de valor', objetivo: 'Reciprocidade: entregar algo útil enquanto a conversa não volta (Cialdini)', template: '{{nome}}, enquanto a gente não retoma, uma orientação que já vale:\n\n{{dica}}.\n\nMe responda quando puder que eu continuo a sua orientação do ponto exato em que paramos.' },
          { dia: 3, canal: 'WhatsApp', titulo: 'Pergunta de baixo atrito', objetivo: 'Facilitar a resposta: pedir pouco (um sim ou uma ligação)', template: '{{nome}}, para eu montar a orientação certa para {{caso}}, falta só concluirmos aquela conversa.\n\nConsegue me responder por aqui hoje? Se ficar mais fácil, me diga um horário e eu te ligo.' },
          { dia: 7, canal: 'WhatsApp', titulo: 'Pergunta orientada ao "não"', objetivo: 'O "não" destrava quem sumiu (Voss) + implicação sóbria', template: '{{nome}}, você desistiu de resolver {{caso}}?\n\nSe a rotina atropelou, me responda só "continua" que eu retomo tudo do ponto em que paramos — lembrando que {{urgencia}}.' },
          { dia: 12, canal: 'WhatsApp', titulo: 'Pausa declarada', objetivo: 'Encerrar com porta aberta e registro do cuidado (última chance de resposta)', template: '{{nome}}, vou pausar o seu atendimento por aqui por enquanto.\n\nNossa conversa fica guardada: quando quiser continuar, é só me chamar que retomo do mesmo ponto. Só não deixe para a última hora — {{urgencia}}.' }
        ]
      },
      {
        id: 'agendamento-consulta',
        nome: 'Agendamento — Marcar a Consulta',
        cenario: 'Lead qualificado sumiu na hora de agendar a consulta com o especialista',
        ref: 'Blount (persistência) + need-payoff SPIN + escassez honesta (Cialdini)',
        passos: [
          { dia: 0, hora: 'agora+2h', canal: 'WhatsApp', titulo: 'Proposta de agendamento', objetivo: 'Baixo atrito: pedir o PERÍODO, não a data exata', template: '{{nome}}, pelo que você me contou sobre {{caso}}, o próximo passo certo é a consulta com o nosso especialista — é nela que você recebe a orientação completa e sai sabendo exatamente o que fazer.\n\nPara eu reservar o seu horário: fica melhor de manhã ou à tarde?' },
          { dia: 1, canal: 'WhatsApp', titulo: 'O valor da consulta', objetivo: 'Need-payoff: pintar o resultado da consulta (SPIN)', template: '{{nome}}, só para você visualizar: na consulta o especialista analisa a sua situação por inteiro e te mostra o caminho para {{beneficio}}.\n\nMe diga o melhor período que eu encaixo o seu horário ainda esta semana.' },
          { dia: 3, canal: 'WhatsApp', titulo: 'Agenda fechando', objetivo: 'Escassez honesta: a agenda do especialista é real e limitada', template: '{{nome}}, a agenda do especialista para esta semana está fechando.\n\nAinda consigo te encaixar — me confirma o período (manhã ou tarde) que eu garanto o seu horário.' },
          { dia: 7, canal: 'WhatsApp', titulo: 'Pergunta orientada ao "não"', objetivo: 'Destravar a decisão + implicação (Voss + SPIN)', template: '{{nome}}, você desistiu de agendar a consulta sobre {{caso}}?\n\nPergunto porque {{urgencia}} — e uma hora de consulta esclarece o que meses de espera só aumentam. Se quiser, eu agendo agora para você.' },
          { dia: 12, canal: 'WhatsApp', titulo: 'Liberar a reserva', objetivo: 'Aversão à perda: soltar a vaga provoca a decisão', template: '{{nome}}, vou liberar a reserva que estava segurando para a sua consulta, combinado?\n\nQuando decidir cuidar de {{caso}}, me chama que eu verifico a primeira agenda disponível. Será um prazer te receber.' }
        ]
      },
      {
        id: 'consulta-marcada',
        nome: 'Consulta Marcada — Confirmação e Lembretes',
        cenario: 'Consulta agendada: garantir presença (aplicar com "Começar em" = DIA da consulta + horário)',
        ref: 'Compromisso e coerência (Cialdini) — anti no-show de ponta a ponta',
        pedirHora: true,
        passos: [
          { dia: -2, canal: 'WhatsApp', titulo: 'Confirmação + preparação', objetivo: 'Compromisso ativo: pedir confirmação e dar tarefa útil (documentos)', template: '{{nome}}, sua consulta sobre {{caso}} está chegando: {{data_consulta}}, às {{hora_consulta}}.\n\nPara aproveitarmos ao máximo, separe documentos, comprovantes e anotações relacionados ao caso — tudo o que tiver ajuda o especialista a ser mais preciso.\n\nMe confirma que está tudo certo para esse dia?' },
          { dia: -1, hora: '16:00', canal: 'WhatsApp', titulo: 'Véspera', objetivo: 'Confirmação de véspera com pedido explícito de OK', template: '{{nome}}, amanhã às {{hora_consulta}} o especialista estará te esperando para a consulta sobre {{caso}}.\n\nMe confirma a sua presença com um OK? Se surgiu algum imprevisto, me avisa ainda hoje que eu ajusto o horário para você.' },
          { dia: 0, hora: '08:30', canal: 'WhatsApp', titulo: 'Manhã do dia', objetivo: 'Lembrete do dia + reforço de exclusividade do horário', template: 'Bom dia, {{nome}}! Hoje é o dia da sua consulta, às {{hora_consulta}}.\n\nO especialista reservou esse horário exclusivamente para o seu caso. Qualquer imprevisto, me avise por aqui o quanto antes.' },
          { dia: 0, hora: 'ref-1h', canal: 'WhatsApp', titulo: 'Uma hora antes', objetivo: 'Último lembrete, perto o bastante para garantir a presença', template: '{{nome}}, daqui a pouco, às {{hora_consulta}}, começa a sua consulta sobre {{caso}}.\n\nDeixe os documentos à mão. Até já!' }
        ]
      },
      {
        id: 'no-show',
        nome: 'No-Show — Recuperar a Consulta Perdida',
        cenario: 'Lead faltou à consulta marcada: resgatar sem culpa e remarcar',
        ref: 'Zero culpa (culpa gera fuga) + baixo atrito + no-oriented (Voss)',
        passos: [
          { dia: 0, hora: 'agora+1h', canal: 'WhatsApp', titulo: 'Resgate sem culpa', objetivo: 'Acolher o imprevisto e abrir a remarcação no mesmo dia', template: '{{nome}}, sentimos a sua falta na consulta de hoje — e está tudo bem: imprevistos acontecem com todo mundo.\n\nO especialista pode te atender em outro horário. Me diga o melhor período (manhã ou tarde) que eu remarco agora mesmo.' },
          { dia: 2, canal: 'WhatsApp', titulo: 'Remarcação facilitada', objetivo: 'Pedir só o período — atrito mínimo', template: '{{nome}}, seguimos com a agenda aberta para remarcarmos a sua consulta sobre {{caso}}.\n\nPara facilitar: me diga só o período que fica melhor para você (manhã ou tarde) que eu cuido de todo o resto.' },
          { dia: 5, canal: 'WhatsApp', titulo: 'Pergunta orientada ao "não"', objetivo: 'Destravar quem sumiu + implicação sóbria (Voss + SPIN)', template: '{{nome}}, você desistiu de tratar {{caso}} com o especialista?\n\nSe a agenda apertou, sem problema nenhum — me diga quando fica bom e eu encaixo. Só lembro que {{urgencia}}.' },
          { dia: 9, canal: 'WhatsApp', titulo: 'Liberar o espaço', objetivo: 'Aversão à perda: soltar a vaga provoca a resposta', template: '{{nome}}, vou liberar o espaço que estava guardando para a sua remarcação, combinado?\n\nQuando quiser retomar, me chama que eu verifico a primeira agenda disponível — será um prazer te receber.' }
        ]
      },
      {
        id: 'pos-proposta',
        nome: 'Pós-Proposta',
        cenario: 'Proposta de honorários enviada, aguardando decisão',
        ref: 'Jeb Blount (pós-proposta) + Voss (calibradas) + implicação SPIN',
        passos: [
          { dia: 1, canal: 'WhatsApp', titulo: 'Confirmação de recebimento', objetivo: 'Garantir que a proposta foi vista e abrir espaço para dúvidas', template: 'Olá, {{nome}}! Conseguiu ler com calma a proposta que enviei sobre {{caso}}?\n\nSe algum ponto não ficou claro — escopo, etapas ou honorários — me fala que eu te explico em uma mensagem.' },
          { dia: 3, canal: 'WhatsApp', titulo: 'Descobrir o que trava', objetivo: 'Pergunta calibrada revela a objeção real (Voss)', template: '{{nome}}, me ajuda a te ajudar: de 0 a 10, quanto essa proposta faz sentido para você hoje?\n\nE o que faltaria para virar um 10? Com a sua resposta eu ajusto exatamente o que importa.' },
          { dia: 7, canal: 'WhatsApp', titulo: 'O custo de esperar', objetivo: 'Implicação (SPIN): tornar visível o custo da indecisão, sem pressão artificial', template: '{{nome}}, um ponto que considero justo te lembrar: {{urgencia}}.\n\nA proposta que te enviei existe justamente para {{beneficio}}. Se quiser, revisamos juntos ponto a ponto — me diga o melhor horário.' },
          { dia: 12, canal: 'WhatsApp', titulo: 'Reserva de agenda', objetivo: 'Escassez honesta: agenda real do escritório, sem inventar prazos', template: '{{nome}}, para eu reservar a equipe para {{caso}}, preciso da sua confirmação.\n\nCom o seu "vamos", já organizo a documentação inicial e os primeiros passos. Consegue me dar uma posição até o fim da semana?' },
          { dia: 21, canal: 'WhatsApp', titulo: 'Arquivamento da proposta', objetivo: 'Encerrar com elegância e provocar a decisão (aversão à perda)', template: '{{nome}}, vou arquivar a sua proposta por enquanto, combinado?\n\nSe decidir seguir com {{caso}}, me chama que eu reviso as condições e a agenda. Foi um prazer conversar com você.' }
        ]
      },
      {
        id: 'vou-pensar',
        nome: 'Objeção: "Vou Pensar"',
        cenario: 'Lead pediu tempo para pensar ou decidir',
        ref: 'Chris Voss (calibradas + rótulos) + Jeb Blount (Objections)',
        passos: [
          { dia: 2, canal: 'WhatsApp', titulo: 'Pergunta calibrada', objetivo: 'Descobrir a dúvida real por trás do "vou pensar"', template: '{{nome}}, enquanto você avalia com calma, me tira uma dúvida: o que mais pesa na sua decisão hoje — o investimento, o momento, ou entender melhor como o processo funciona?\n\nPergunto para te trazer a resposta certa, em vez de te mandar mensagem à toa.' },
          { dia: 5, canal: 'WhatsApp', titulo: 'Orientação que decide', objetivo: 'Responder a dúvida provável com informação útil (reciprocidade)', template: '{{nome}}, pensando na sua decisão sobre {{caso}}, uma informação que costuma ajudar:\n\n{{dica}}.\n\nE vale saber que {{urgencia}} — por isso organizei tudo para você decidir com segurança, não com pressa.' },
          { dia: 10, canal: 'Ligação', titulo: 'Ligação de decisão', objetivo: 'Voz destrava o que o texto não resolve', template: '(Ligar primeiro. Se não atender, enviar:)\n\n{{nome}}, te liguei porque 5 minutos de conversa resolvem mais que 20 mensagens.\n\nQual o melhor horário hoje ou amanhã para falarmos sobre {{caso}}?' },
          { dia: 20, canal: 'WhatsApp', titulo: 'Pausa declarada', objetivo: 'Rótulo de empatia + aversão à perda (Voss)', template: '{{nome}}, parece que este não é o melhor momento para você — e está tudo bem.\n\nVou pausar o seu atendimento por aqui. Só deixo registrado, porque é meu dever te orientar: {{urgencia}}. Quando quiser retomar, é só me chamar.' }
        ]
      },
      {
        id: 'documentacao',
        nome: 'Documentação — Enviar os Documentos',
        cenario: 'Proposta ACEITA (pagamento combinado): falta o cliente enviar a documentação do contrato e da procuração',
        ref: 'Compromisso e coerência (Cialdini) + remoção de atrito — tom de cliente, não de venda',
        passos: [
          { dia: 0, hora: 'agora+1h', canal: 'WhatsApp', titulo: 'Lista clara + facilitador', objetivo: 'Dizer exatamente o que precisa e derrubar o atrito (foto pelo WhatsApp serve)', template: '{{nome}}, que alegria ter você com a gente! Para eu preparar o seu contrato e a procuração, preciso destes documentos:\n\n{{documentos}}.\n\nPode mandar foto legível aqui mesmo pelo WhatsApp — não precisa escanear nada. Conforme for achando, vai me enviando.' },
          { dia: 2, canal: 'WhatsApp', titulo: 'Oferta de ajuda', objetivo: 'Descobrir se algum documento é a trava e resolver junto', template: '{{nome}}, como está a separação dos documentos?\n\nSe algum deles estiver difícil de achar, me diga qual — na maioria dos casos eu te oriento exatamente onde conseguir (e alguns dá para emitir pela internet em minutos).' },
          { dia: 5, canal: 'WhatsApp', titulo: 'O caso não anda sem eles', objetivo: 'Implicação sóbria + coerência com o que já foi combinado', template: '{{nome}}, como combinamos, está tudo pronto do nosso lado para iniciar o seu caso — só falta a documentação para eu emitir o contrato e a procuração.\n\nLembrando que {{urgencia}}. Me envia o que já tiver em mãos que eu adianto o que der.' },
          { dia: 9, canal: 'WhatsApp', titulo: 'Diagnóstico da trava', objetivo: 'Pergunta direta que revela o problema real (Voss)', template: '{{nome}}, me ajuda a entender: algum documento está difícil de conseguir, ou o momento é que está corrido?\n\nQualquer um dos dois tem solução — me conta que eu resolvo com você.' },
          { dia: 14, canal: 'WhatsApp', titulo: 'Pausa do processo', objetivo: 'Aversão à perda: sem documentos, a contratação fica em espera', template: '{{nome}}, vou deixar a sua contratação em espera até a documentação chegar, combinado?\n\nAssim que você me enviar, retomo na hora — o seu caso merece começar logo, e {{urgencia}}.' }
        ]
      },
      {
        id: 'assinatura',
        nome: 'Assinatura — Contrato e Procuração',
        cenario: 'Documentos recebidos, contrato e procuração enviados: falta o cliente assinar o link',
        ref: 'Últimos metros: facilidade + coerência — probabilidade alta, atrito zero',
        passos: [
          { dia: 0, hora: 'agora+2h', canal: 'WhatsApp', titulo: 'Link chegou?', objetivo: 'Confirmar recebimento e mostrar que é rápido e fácil', template: '{{nome}}, te enviei o link do contrato e da procuração para assinatura.\n\nÉ tudo digital: leva uns 2 minutos e dá para assinar direto do celular. Qualquer dificuldade para abrir, me chama que eu te guio passo a passo.' },
          { dia: 1, canal: 'WhatsApp', titulo: 'Suporte técnico', objetivo: 'Derrubar a trava técnica (link perdido, celular, dúvida de como assinar)', template: '{{nome}}, conseguiu abrir o link da assinatura?\n\nSe ele se perdeu na conversa ou deu qualquer problema, me avisa que eu reenvio agora — ou, se preferir, te ligo e fazemos juntos em 2 minutos.' },
          { dia: 3, canal: 'WhatsApp', titulo: 'Por que a assinatura importa', objetivo: 'Implicação: só com a procuração assinada o escritório pode atuar', template: '{{nome}}, um lembrete importante: é a procuração assinada que autoriza o escritório a atuar formalmente no seu caso — sem ela, ainda não podemos dar nenhum passo por você.\n\nE {{urgencia}}. Assina hoje e eu já coloco sua demanda em andamento.' },
          { dia: 7, canal: 'WhatsApp', titulo: 'Alguma dúvida no contrato?', objetivo: 'Abrir espaço para a dúvida não dita (Voss) — sem pressão', template: '{{nome}}, ficou alguma dúvida em algum ponto do contrato ou da procuração? É normal, e faço questão de esclarecer: me pergunte o que quiser.\n\nVocê já cuidou de tudo até aqui — falta só esse último passo para o seu caso começar oficialmente.' },
          { dia: 10, canal: 'WhatsApp', titulo: 'Concluir juntos', objetivo: 'Fechamento facilitado: reenvio ou ligação assistida', template: '{{nome}}, o seu contrato está pronto, aguardando só a assinatura.\n\nMe diga o que prefere: eu reenvio o link agora, ou marcamos uma ligação rápida e concluímos juntos? Quero deixar tudo certo para o seu caso andar.' }
        ]
      },
      {
        id: 'boas-vindas',
        nome: 'Boas-Vindas — Cliente Novo',
        cenario: 'Contrato e procuração assinados: primeira semana como cliente',
        ref: 'Onboarding: matar a ansiedade do "e agora?" e firmar o canal de contato',
        passos: [
          { dia: 0, hora: 'agora+1h', canal: 'WhatsApp', titulo: 'Boas-vindas oficiais', objetivo: 'Marcar o início formal + próximos passos + canal direto', template: '{{nome}}, seja muito bem-vindo(a)! A partir de agora o {{empresa}} está oficialmente cuidando de {{caso}}.\n\nPróximos passos: nossa equipe já iniciou a análise completa da sua documentação e a preparação das primeiras providências.\n\nEste WhatsApp é o seu canal direto — qualquer dúvida, a qualquer momento, é só chamar.' },
          { dia: 3, canal: 'WhatsApp', titulo: 'Caso em andamento', objetivo: 'Confirmar movimento e ajustar a expectativa de comunicação', template: '{{nome}}, passando para confirmar: o seu caso já está em andamento por aqui.\n\nAssim que houver o primeiro ato formal — protocolo, distribuição ou providência equivalente — você recebe o registro por esta conversa.\n\nEstamos cuidando de tudo.' },
          { dia: 7, canal: 'WhatsApp', titulo: 'Check-in da primeira semana', objetivo: 'Abrir espaço para dúvidas cedo (dúvida engolida vira insatisfação)', template: '{{nome}}, primeira semana como nosso cliente completada!\n\nFicou alguma dúvida sobre o andamento ou sobre o que acontece daqui para frente? Pergunte à vontade — preferimos explicar duas vezes a te deixar com qualquer dúvida.' }
        ]
      },
      {
        id: 'encerramento',
        nome: 'Encerramento — Avaliação e Indicação',
        cenario: 'Caso concluído: agradecer, colher avaliação e abrir a porta das indicações',
        ref: 'Pico de satisfação (Cialdini: reciprocidade) — o motor de indicações do escritório',
        passos: [
          { dia: 0, canal: 'WhatsApp', titulo: 'Conclusão e gratidão', objetivo: 'Encerramento formal com agradecimento genuíno', template: '{{nome}}, chegamos à conclusão do seu caso — e queremos agradecer de coração a confiança que você depositou no {{empresa}}.\n\nFoi um privilégio cuidar de {{caso}}. Toda a documentação fica arquivada com a gente: se precisar de qualquer via ou esclarecimento no futuro, é só pedir.' },
          { dia: 3, canal: 'WhatsApp', titulo: 'Pedido de avaliação', objetivo: 'Colher a avaliação pública no momento de maior satisfação', template: '{{nome}}, um pedido que vale muito para nós: se você ficou satisfeito(a) com o atendimento, deixe a sua avaliação na nossa página do Google — leva 1 minuto e ajuda outras pessoas a nos encontrarem.\n\nSe preferir, me peça o link que eu te envio por aqui.' },
          { dia: 10, canal: 'WhatsApp', titulo: 'Pedido de indicação', objetivo: 'Reciprocidade no pico: transformar satisfação em novos casos', template: '{{nome}}, uma pergunta de quem confia no seu julgamento: você conhece alguém — família, amigo, colega — passando por uma situação parecida com a que você viveu?\n\nSe fizer sentido indicar, pode ter certeza: cuidaremos dessa pessoa com o mesmo cuidado que tivemos com você.' },
          { dia: 30, canal: 'WhatsApp', titulo: 'Portas abertas', objetivo: 'Fixar o escritório como referência jurídica permanente', template: '{{nome}}, guarde o nosso contato com carinho: para qualquer questão jurídica — sua, da família ou da empresa — este número é o seu canal direto.\n\nAté a próxima, e conte sempre com a gente.' }
        ]
      },
      {
        id: 'regularizacao',
        nome: 'Regularização — Parcela em Atraso',
        cenario: 'Honorário parcelado com pagamento em atraso: cobrar preservando a relação',
        ref: 'Cobrança respeitosa (sem vexame — CDC art. 42): lembrete → renegociação → firmeza',
        passos: [
          { dia: 0, hora: 'agora+2h', canal: 'WhatsApp', titulo: 'Lembrete gentil', objetivo: 'Presumir o esquecimento (preserva a relação) e facilitar a regularização', template: '{{nome}}, tudo bem? Notei que a parcela dos honorários com vencimento recente ainda não foi identificada por aqui.\n\nPode ter sido só um esquecimento — acontece com todo mundo.\n\nSe já pagou, me envia o comprovante que eu dou baixa; se ainda não, me avisa que eu te reenvio os dados de pagamento.' },
          { dia: 4, canal: 'WhatsApp', titulo: 'Oferta de renegociação', objetivo: 'Abrir a saída honrosa: ajustar a data antes de acumular', template: '{{nome}}, se o momento apertou por aí, a gente resolve juntos: posso ajustar a data desta parcela para encaixar melhor no seu mês.\n\nMelhor ajustar do que acumular — me diga o que funciona para você que eu organizo por aqui.' },
          { dia: 9, canal: 'WhatsApp', titulo: 'Firmeza respeitosa', objetivo: 'Elevar a seriedade sem constranger, pedindo retorno no dia', template: '{{nome}}, preciso da sua atenção: a parcela segue em aberto e, para o bom andamento de tudo, precisamos regularizar.\n\nMe retorne ainda hoje, por favor — com o pagamento, o comprovante ou uma proposta de nova data. Estou aqui para encontrar o melhor caminho com você.' }
        ]
      },
      {
        id: 'reaquecimento',
        nome: 'Reaquecimento de Lead Frio',
        cenario: 'Lead antigo/parado há mais de 30 dias',
        ref: 'Receita Previsível (Aaron Ross) + reciprocidade (Cialdini)',
        passos: [
          { dia: 0, canal: 'WhatsApp', titulo: 'Retomada sem cobrança', objetivo: 'Reabrir pelo interesse genuíno, nunca cobrando a falta de resposta', template: 'Olá, {{nome}}! Aqui é {{atendente}}, do {{empresa}} — conversamos há um tempo sobre {{caso}}.\n\nEstava revisando os atendimentos em aberto e lembrei de você: como está essa situação hoje? Muita coisa pode ter mudado aí.' },
          { dia: 10, canal: 'WhatsApp', titulo: 'Orientação de valor', objetivo: 'Reativar entregando algo útil, sem pedir nada (Cialdini)', template: '{{nome}}, mesmo sem retorno, deixo uma orientação que pode te poupar dor de cabeça:\n\n{{dica}}.\n\nSe {{caso}} voltar à pauta, você já sai na frente.' },
          { dia: 25, canal: 'WhatsApp', titulo: 'Convite objetivo', objetivo: 'Proposta clara e de baixo atrito para reengajar', template: '{{nome}}, proposta direta e sem compromisso: 15 minutos de conversa para reavaliarmos {{caso}} e você entender exatamente em que pé está e o que dá para fazer.\n\nMe diga o dia e o horário que ficam bons para você que eu me organizo por aqui.' },
          { dia: 45, canal: 'WhatsApp', titulo: 'Despedida definitiva', objetivo: 'Higienizar a base com porta aberta (última chance de resposta)', template: '{{nome}}, vou tirar o seu contato da minha lista de acompanhamento para não te incomodar mais, combinado?\n\nGuarde o nosso número: se {{caso}} — ou qualquer outra questão jurídica — precisar de atenção um dia, será um prazer te atender.' }
        ]
      }
    ];
  }

  function all() {
    if (!state.cadences || !state.cadences.length) {
      state.cadences = defaults();
      save();
    }
    // v3 (2026-08): funil completo do escritório — qualificação, agendamento da
    // consulta e anti no-show, além das 4 reescritas na v2. Substitui as padrão
    // por id UMA vez, preservando cadências personalizadas do escritório.
    if (!state.settings.cadenciasV6) {
      const novas = defaults();
      const editadas = state.settings.cadenciasEditadas || [];
      novas.forEach(n => {
        if (editadas.includes(n.id)) return; // edições do escritório têm prioridade sobre atualizações
        const i = state.cadences.findIndex(c => c.id === n.id);
        if (i >= 0) state.cadences[i] = n; else state.cadences.push(n);
      });
      // ordena pelo fluxo do funil (padrões primeiro, personalizadas depois)
      const ordem = novas.map(c => c.id);
      state.cadences.sort((a, b) => {
        const ia = ordem.indexOf(a.id), ib = ordem.indexOf(b.id);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
      state.settings.cadenciasV2 = true;
      state.settings.cadenciasV3 = true;
      state.settings.cadenciasV4 = true;
      state.settings.cadenciasV5 = true;
      state.settings.cadenciasV6 = true;
      save();
    }
    return state.cadences;
  }

  function get(id) { return all().find(c => c.id === id); }

  /* a cadência precisa do horário da consulta? DERIVADO dos passos (sobrevive
     ao vai-e-vem da nuvem, que só guarda id/nome/cenario/ref/passos) */
  function pedeHora(c) {
    if (!c) return false;
    if (c.pedirHora) return true;
    return (c.passos || []).some(p => /^ref/.test(p.hora || '') || String(p.template || '').includes('{{hora_consulta}}'));
  }

  /* ---------- aplicação de cadência a um lead ---------- */

  /* hora de disparo dentro da janela comercial das Configurações ('09:00-18:00') */
  function horaDaJanela() {
    const j = String(state.settings.janelaEnvio || '09:00-18:00');
    const m = /^(\d{2}):(\d{2})/.exec(j);
    return m ? m[1] + ':' + m[2] : '09:00';
  }

  /* horário efetivo de um passo:
     - sem p.hora           → início da janela comercial
     - 'HH:MM'              → hora fixa
     - 'ref' / 'ref-1h'     → relativo ao horário da consulta (opts.horaRef)
     - 'agora+2h'/'agora+30m' → relativo ao momento em que a cadência é aplicada */
  function horaDoPasso(p, horaJanela, horaRef) {
    const h = p && p.hora;
    if (!h) return horaJanela;
    if (/^\d{2}:\d{2}$/.test(h)) return h;
    if (/^ref/.test(h)) {
      if (!horaRef) return horaJanela;
      const m = /-(\d+)h/.exec(h);
      const [H, M] = horaRef.split(':').map(Number);
      const d = new Date(2000, 0, 1, H || 0, M || 0);
      if (m) d.setHours(d.getHours() - Number(m[1]));
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    return horaJanela;
  }

  /* opts.autoEnviar: além dos lembretes, AGENDA as mensagens de WhatsApp na fila
     que o motor envia sozinho (precisa de conversa vinculada ao lead no Chat)
     opts.horaRef ('HH:MM'): horário da consulta — usado pelos passos 'ref' e {{hora_consulta}} */
  function aplicar(leadId, cadId, baseDate, opts) {
    const cad = get(cadId);
    const lead = getLead(leadId);
    if (!cad || !lead) return 0;
    const auto = !!(opts && opts.autoEnviar);
    const horaRef = (opts && opts.horaRef) || '';
    const conversa = auto ? conversaDoLead(leadId) : null;
    // cancela pendentes anteriores para não duplicar agenda (e as msgs agendadas casadas)
    cancelarPendentes(leadId, 'substituído por nova cadência');
    const base = baseDate || todayISO();
    const hora = horaDaJanela();
    const extras = { hora_consulta: horaRef || 'o horário combinado', data_consulta: fmtDate(base) };
    let agendadas = 0;
    cad.passos.forEach((p, i) => {
      const fu = {
        id: uid(),
        leadId,
        cadenciaId: cad.id,
        cadenciaNome: cad.nome,
        passoIndex: i,
        dia: p.dia,
        canal: p.canal,
        titulo: p.titulo,
        objetivo: p.objetivo,
        template: p.template,
        dueDate: addDaysISO(base, p.dia),
        horaConsulta: horaRef || null,
        status: 'pendente',
        criadoEm: new Date().toISOString()
      };
      // envio automático: só passos de WhatsApp com mensagem pronta e horário futuro
      if (auto && conversa && p.template && String(p.canal).toLowerCase().includes('whats')) {
        let quando;
        const rel = p.hora && /^agora\+(\d+)(h|m)$/.exec(p.hora);
        if (rel) {
          quando = new Date(Date.now() + Number(rel[1]) * (rel[2] === 'h' ? 3600000 : 60000));
        } else {
          quando = new Date(fu.dueDate + 'T' + horaDoPasso(p, hora, horaRef) + ':00');
        }
        if (quando.getTime() > Date.now() - 60000) {
          const texto = renderTemplate(p.template, lead, extras);
          const msg = registrarMensagem(conversa.id, {
            direcao: 'saida', tipo: 'texto',
            texto: typeof assinarTexto === 'function' ? assinarTexto(texto) : texto,   // assinada por quem registrou
            agendadaPara: quando.toISOString(), status: 'agendada'
          });
          if (msg) { fu.msgId = msg.id; fu.autoEnviar = true; agendadas++; }
        }
      }
      state.followups.push(fu);
    });
    registrarEvento(lead, 'followup', 'Cadência aplicada: ' + cad.nome +
      (agendadas ? ' (' + agendadas + ' mensagem(ns) programada(s) no WhatsApp)' : ''));
    save();
    return cad.passos.length;
  }

  function cancelarPendentes(leadId, motivo) {
    let n = 0;
    state.followups.forEach(f => {
      if (f.leadId === leadId && f.status === 'pendente') {
        f.status = 'cancelado';
        f.motivo = motivo || 'cancelado';
        // mensagem automática casada ainda não enviada? sai da fila do motor
        // (vira 'cancelada' — apagar a linha sumia com ela do histórico se já tivesse saído)
        if (f.msgId) {
          cancelarAgendadaLocal(state.mensagens.find(x => x.id === f.msgId));
          f.msgId = null;
        }
        n++;
      }
    });
    if (n) save();
    return n;
  }

  function concluir(fuId) {
    const f = state.followups.find(x => x.id === fuId);
    if (f) { f.status = 'feito'; f.feitoEm = new Date().toISOString(); save(); }
    return f;
  }

  function pular(fuId) {
    const f = state.followups.find(x => x.id === fuId);
    if (f) { f.status = 'pulado'; save(); }
    return f;
  }

  function adiar(fuId, dias) {
    const f = state.followups.find(x => x.id === fuId);
    if (f) { f.dueDate = addDaysISO(f.dueDate < todayISO() ? todayISO() : f.dueDate, dias); save(); }
    return f;
  }

  function pendentesDoLead(leadId) {
    return state.followups.filter(f => f.leadId === leadId && f.status === 'pendente')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  function historicoDoLead(leadId) {
    return state.followups.filter(f => f.leadId === leadId)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }

  /* agrupa follow-ups pendentes para a agenda */
  function agenda() {
    const hoje = todayISO();
    const amanha = addDaysISO(hoje, 1);
    const semana = addDaysISO(hoje, 7);
    const pend = state.followups.filter(f => f.status === 'pendente')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return {
      atrasados: pend.filter(f => f.dueDate < hoje),
      hoje: pend.filter(f => f.dueDate === hoje),
      amanha: pend.filter(f => f.dueDate === amanha),
      semana: pend.filter(f => f.dueDate > amanha && f.dueDate <= semana),
      depois: pend.filter(f => f.dueDate > semana)
    };
  }

  /* ---------- biblioteca de mensagens avulsas ---------- */
  const TEMPLATES_AVULSOS = [
    { titulo: 'Reagendar reunião perdida', texto: 'Oi {{nome}}! Nossa conversa de hoje não rolou — imagino que tenha surgido algo aí. 🙂\n\nSem problema nenhum! Me fala dois horários que funcionam pra você essa semana que eu me organizo por aqui.' },
    { titulo: 'Pedir indicação (pós-venda)', texto: '{{nome}}, que alegria ter você como cliente! 🙌\n\nMe conta: você conhece alguém que também sofre com [dor que resolvemos]? Se puder me indicar, cuido dessa pessoa com o mesmo carinho — e te agradeço com [benefício/cortesia].' },
    { titulo: 'Aniversário / data especial', texto: '{{nome}}, feliz aniversário! 🎉 Que seu novo ciclo venha com muita saúde e prosperidade.\n\nUm abraço, {{atendente}} — {{empresa}}.' },
    { titulo: 'Confirmação de reunião (véspera)', texto: 'Oi {{nome}}! Confirmando nossa conversa de amanhã às [hora]. 📅\n\nSepara uns 20 minutinhos sem interrupção que eu te mostro tudo direitinho. Até lá!' },
    { titulo: 'Boas-vindas ao novo cliente', texto: '{{nome}}, seja muito bem-vindo(a) à {{empresa}}! 🎉\n\nA partir de agora, [o que acontece: próximos passos, quem entra em contato, prazos]. Qualquer dúvida, meu contato é esse aqui — pode me chamar direto.' }
  ];

  return { defaults, all, get, pedeHora, aplicar, cancelarPendentes, concluir, pular, adiar, pendentesDoLead, historicoDoLead, agenda, TEMPLATES_AVULSOS };
})();
