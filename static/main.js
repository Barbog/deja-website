/* eslint-env browser, jquery */
$(function () {
  $('.disabled').on('click', function (e) {
    e.preventDefault()
  })
  $('.carousel-container').flickity({
    wrapAround: true,
    autoPlay: 3000,
    adaptiveHeight: false,
    dragThreshold: 10,
    prevNextButtons: false
  })
  $('input[data-yesno]').click(function (e) {
    $('.explanation[data-question=' + $(e.target).data('question') + ']').each(function () {
      var explanation = $(this)
      var yesno = explanation.data('yesno') === $(e.target).data('yesno')
      explanation.toggleClass('visible', yesno)
      explanation.find('input').attr('required', yesno ? 'required' : false)
    })
  })
  $('.easyautocomplete-country').each(function () {
    var country = $(this)
    country.easyAutocomplete({
      url: '/EasyAutocomplete/demo/resources/countries.json',
      getValue: 'name',
      highlightPhrase: false,
      list: {
        match: {
          enabled: true
        },
        sort: {
          enabled: true,
          method: function (ao, bo) {
            var a = ao.name.toLowerCase()
            var b = bo.name.toLowerCase()
            var c = country.val().toLowerCase()
            var ac = a.substr(0, c.length) === c
            var bc = b.substr(0, c.length) === c
            return ac !== bc ? ac ? -1 : 1 : a < b ? -1 : a > b ? 1 : 0
          }
        }
      }
    })
  })
  var checkpassword = function () {
    var val = $('#userdata #newpassword').val()
    if (typeof val !== 'string') val = ''
    val = val.length > 0
    $('#userdata #password, #userdata #newpasswordrepeat').toggle(val).attr('required', val ? 'required' : false)
    setTimeout(checkpassword, 50)
  }
  setTimeout(checkpassword, 1)
  $.modal.defaults.escapeClose = false
  $.modal.defaults.clickClose = false
  $.modal.defaults.showClose = false
  $('#userdata button[type="submit"]').on('click', function () {
    var update = null
    var name = $('#userdata #realname').val()
    if (name !== $('#userdata #realname').data('name')) {
      if (update === null) {
        update = {}
      }
      update.name = name
    }
    var newpassword = $('#userdata #newpassword').val()
    if (newpassword !== '') {
      var oldpassword = $('#userdata #password').val()
      if (oldpassword === '') {
        alert('Old pasword not provided.')
        return false
      } else if (newpassword !== $('#userdata #newpasswordrepeat').val()) {
        alert('New pasword repeat does not match up.')
        return false
      } else {
        if (update === null) {
          update = {}
        }
        update.password = oldpassword
        update.newpassword = newpassword
      }
    }
    if (update !== null) {
      $('#userdata button[type="submit"]').remove()
      $.ajax({
        method: 'POST',
        url: '/user/update',
        dataType: 'json',
        data: update
      }).done(function () {
        $.modal.close()
        location.reload()
      })
    } else {
      $.modal.close()
    }
    return false
  })
  $('#userdata input').keypress(function (e) {
    if (e.which === 13) {
      if (e.target.id === 'newpassword') {
        if ($(e.target).val().length > 0) {
          $(e.target).blur()
          return false
        }
      }
      $.modal.close()
      return false
    }
  })
  $('.altlang').on('click', function (e) {
    var lang = e.target.hreflang
    if (lang) {
      document.cookie = 'lang=' + lang + ';path=/;max-age=' + (60 * 60 * 24 * 365)
    }
  })
  var hoverTree = function () {
    var links = $('.tree a').removeClass('hover')
    if (links.length > 0) {
      $(links[Math.floor(Math.random() * links.length)]).addClass('hover')
    }
    setTimeout(hoverTree, (Math.floor(Math.random() * 2) + 2) * 1000) // every 2 - 4 seconds
  }
  hoverTree()
})
