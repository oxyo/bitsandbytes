

/*Common Modules*/
var async = require('async');
var _ = require('underscore');


var FieldDecoder = require('./lib/decoder');
//var FieldEncoder = require('./lib/FieldEncoder');

var TwinkleBits = function(fieldDecoder, fieldEncoder) {
    this.fieldDecoder = fieldDecoder || new FieldDecoder;
//    this.fieldEncoder = fieldEncoder || new FieldEncoder;
};

TwinkleBits.prototype.decode =function(buffer, spec, cb){

    var cbFlag = false;
    var that = this;
    var _decodedObject = {};

    if (!(buffer && buffer.length > 0)) {
        !cbFlag && (cbFlag = true) && process.nextTick(function(){cb("INVALID_STREAMS", null)});
        return null;
    }

    if (!(spec)) {
        !cbFlag && (cbFlag = true) && process.nextTick(function(){cb("INVALID_MESSAGE_SPECIFICATION", null)});
        return null;
    }


    if(spec.headers && spec.headers.length > 0 ){

        var reqObject = { buffer : buffer, spec : spec,bytePointer : 0,bitPointer:0 }

        this.decodeHeader(reqObject, function(err, _object){

            if(err){ cb("HEADERS_DECODING_FAILED", null); return null; }

            _decodedObject.headers = _object ;

            var messageTypeField = _.findWhere(spec.headers, { messageType : true });

            if(spec.masking && spec.masking.reportMaskField){

                var reportMaskField = _.findWhere(spec.headers, { reportMask : true });
                spec.masking.defaultReportMask  =_object[reportMaskField.name] || spec.masking.defaultReportMask

            }


            if(messageTypeField){

                that.decodeMessageTypes({buffer : buffer, spec : spec, messageType : _object[messageTypeField.name],bytePointer : reqObject.bytePointer, bitPointer : reqObject.bitPointer }, function(err, _object){

                    if(err){
                        _decodedObject.msg = err ;
                    }else{
                        _decodedObject.msg = _object ;
                    }
                    cb(null, _decodedObject);

                });

            }else{

                _decodedObject.msg = "NO_MESSAGE_TYPE_FIELD" ;
                cb(null, _decodedObject);

            }


        });
    }else if(spec.fields && spec.fields.length > 0 ){

        this.decodeFields({buffer : buffer, spec : spec, fields : spec.fields},function(err, _object){
            if(err){
                cb("FIELDS_DECODING_FAILED", null); return null;
            }
            cb(null, _object);
        });

    }else{

        cb("INVALID_SPEC_FIELDS", null);

    }







};

TwinkleBits.prototype.decodeHeader =function(reqObject, cb){

    var that = this;
    var spec = reqObject.spec;
    var buffer = reqObject.buffer;

    reqObject.fields = spec.headers
    reqObject.headerFields = true

    this.decodeFields(reqObject,function(err, _object){

        if(err){ cb("FIELDS_DECODING_FAILED", null); return null; }
        cb(null, _object);

    });

};

TwinkleBits.prototype.decodeMessageTypes =function(reqObject, cb){

    var that = this;
    var fields = reqObject.spec.messageTypes[reqObject.messageType]
    if(fields && fields.length > 0){

        that.decodeFields({buffer : reqObject.buffer , spec : reqObject.spec ,fields : fields, bytePointer : reqObject.bytePointer, bitPointer : reqObject.bitPointer}, function(err, messageTypeObject){
            err ? cb ("MESSAGE_DECODING_FAILED",null) : cb(null, messageTypeObject)
            err ? console.log(err.stack) : ''
        });

    }else{
        cb("INVALID_MESSAGE_FIELDS", null)
    }


};

TwinkleBits.prototype.decodeFields = function(reqObject, cb){




    var that = this;
    var spec = reqObject.spec;
    var buffer = reqObject.buffer;
    var bytePointer = reqObject.bytePointer || 0;
    var bitPointer = reqObject.bitPointer || 0;
    var decodeFun, _fields, field, _err = null;
    var obj = {};  //TODO dont use this
    var bitMask = reqObject.bitMask || null;

    if(spec.masking){
        if(bitMask || ( spec.masking && spec.masking.defaultReportMask ) ){
            bitMask = new BitView(new Buffer(spec.masking.defaultReportMask,'hex').reverse())
        }else{
            cb("INVALID_REPORT_MASK", null);
            return null;
        }
    }


    spec.bigEndian ?  ( decodeFun = this.fieldDecoder.decodeFieldBE ) : ( decodeFun = this.fieldDecoder.decodeFieldLE );

    var fieldsIterator = function(field, fieldsIterator_cb){
        var _flag = false ;
        if( !spec.masking || (reqObject.headerFields && !spec.masking.headerMasking) || ( _flag = bitMask && bitMask.getBits(field.maskBit,1) ) ){

            _flag ? (field.start = bytePointer) : null;

            try{
                if( field && field.type === 'byte' && field.spec){

                    field.spec.bigEndian = (field.spec && field.spec.bigEndian) || spec.bigEndian || false ;

                    that.decode(decodeFun(buffer, field),field.spec, function(err, result){

                        _flag ? (bytePointer = (bytePointer + getFieldLength(field))) : null

                        if(!err){
                            (typeof field.postDecode === 'function') ? obj[field.name] = field.postDecode(result ) : obj[field.name] = result ;
                            fieldsIterator_cb(null);
                        }else{
                            fieldsIterator_cb(err);
                        }
                    });

                }else{
                    (typeof field.postDecode === 'function') ? (obj[field.name] = field.postDecode( decodeFun(buffer, field) )) : (obj[field.name] = decodeFun(buffer, field)) ;
                    _flag ? (bytePointer = (bytePointer + getFieldLength(field))) : null
                    fieldsIterator_cb(null);
                }
            }catch (err){

                fieldsIterator_cb(err);
            }

        }else{
            fieldsIterator_cb(null);
        }
    };

    async.forEachSeries(reqObject.fields, fieldsIterator, function(err) {
        reqObject.bytePointer = bytePointer ;
        reqObject.bitPointer = bitPointer ;
        err ? cb(err, null) : cb(null, obj);
    });

};


var getFieldLength = function(fieldSpec){
    switch (fieldSpec.type) {
        case 'int8':
        case 'uint8':
            return 1;
        case 'int16':
        case 'uint16':
            return 2;
        case 'int32':
        case 'uint32':
        case 'float':
        case 'double':
            return 4;
        case 'ascii':
        case 'utf8':
        case 'hex':
        case 'byte':
            return fieldSpec.length;
    }
};


module.exports =  TwinkleBits;


