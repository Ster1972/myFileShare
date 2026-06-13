(function () {
  const toSender = document.getElementById('to-sender');
  const toReceiver = document.getElementById('to-receiver');
  if (toSender) toSender.addEventListener('click', () => { window.location.href = 'sender.html'; });
  if (toReceiver) toReceiver.addEventListener('click', () => { window.location.href = 'receiver.html'; });
})();
